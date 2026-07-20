[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$GitleaksPath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$RepositoryPath,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ReportPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$')]
    [string]$ExpectedCandidateCommit
)

$ErrorActionPreference = 'Stop'
$expectedScannerVersion = '8.30.1'
$findingExitCode = 42
$tempDirectory = $null
$safeReportStagingPath = $null
$safeReportFinalPath = $null
$failureCode = $null

function Stop-SafeValidation {
    param([Parameter(Mandatory = $true)][string]$Code)

    throw [System.InvalidOperationException]::new($Code)
}

function Get-CanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Test-IsPathInside {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $candidateFull = Get-CanonicalPath $Candidate
    $parentFull = Get-CanonicalPath $Parent
    if ($candidateFull.Equals($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment['NO_COLOR'] = '1'
    $startInfo.Environment['GIT_NO_REPLACE_OBJECTS'] = '1'
    $startInfo.Environment['GIT_NO_LAZY_FETCH'] = '1'

    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            Stop-SafeValidation 'GL-PROCESS-START'
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()

        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdoutTask.GetAwaiter().GetResult()
            Stderr   = $stderrTask.GetAwaiter().GetResult()
        }
    }
    finally {
        $process.Dispose()
    }
}

function Invoke-GitText {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $result = Invoke-CapturedProcess -FilePath 'git' -Arguments (@('-C', $Repository) + $Arguments) -WorkingDirectory $Repository
    if ($result.ExitCode -ne 0) {
        Stop-SafeValidation 'GL-GIT-COMMAND'
    }
    return $result.Stdout.Trim()
}

function Get-RequiredJsonString {
    param(
        [Parameter(Mandatory = $true)][System.Text.Json.JsonElement]$Element,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = [System.Text.Json.JsonElement]::new()
    if (-not $Element.TryGetProperty($Name, [ref]$property)) {
        Stop-SafeValidation 'GL-RAW-SCHEMA'
    }
    if ($property.ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
        Stop-SafeValidation 'GL-RAW-SCHEMA'
    }
    return $property.GetString()
}

function Convert-ToSafeFindingPath {
    param(
        [Parameter(Mandatory = $true)][string]$RawPath,
        [Parameter(Mandatory = $true)][string]$Repository
    )

    if (
        [string]::IsNullOrWhiteSpace($RawPath) -or
        $RawPath.Contains([char]0) -or
        $RawPath.Contains("`r") -or
        $RawPath.Contains("`n") -or
        [System.IO.Path]::IsPathRooted($RawPath) -or
        $RawPath -match '^[A-Za-z]:' -or
        $RawPath.StartsWith('\\')
    ) {
        Stop-SafeValidation 'GL-PATH-SCHEMA'
    }

    $normalized = $RawPath.Replace('\', '/')
    while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
        $normalized = $normalized.Substring(2)
    }

    $segments = @($normalized.Split('/'))
    if ($segments.Count -eq 0) {
        Stop-SafeValidation 'GL-PATH-SCHEMA'
    }
    foreach ($segment in $segments) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -in @('.', '..')) {
            Stop-SafeValidation 'GL-PATH-SCHEMA'
        }
        if ($segment -ieq '.git') {
            Stop-SafeValidation 'GL-PATH-SCHEMA'
        }
    }

    $candidatePath = Get-CanonicalPath (Join-Path $Repository ($normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
    if (-not (Test-IsPathInside -Candidate $candidatePath -Parent $Repository)) {
        Stop-SafeValidation 'GL-PATH-CONTAINMENT'
    }

    return $normalized
}

function Read-RedactedFindings {
    param(
        [Parameter(Mandatory = $true)][string]$RawReportPath,
        [Parameter(Mandatory = $true)][ValidateSet('history', 'tree')][string]$Scope,
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$CandidateCommit,
        [Parameter(Mandatory = $true)][System.Collections.Generic.HashSet[string]]$ReachableCommits
    )

    if (-not (Test-Path -LiteralPath $RawReportPath -PathType Leaf)) {
        Stop-SafeValidation 'GL-RAW-MISSING'
    }

    $fileInfo = Get-Item -LiteralPath $RawReportPath
    if ($fileInfo.Length -gt 64MB) {
        Stop-SafeValidation 'GL-RAW-SIZE'
    }

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    try {
        $jsonText = $utf8.GetString([System.IO.File]::ReadAllBytes($RawReportPath))
        $document = [System.Text.Json.JsonDocument]::Parse($jsonText)
    }
    catch {
        Stop-SafeValidation 'GL-RAW-JSON'
    }

    $allowedProperties = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($name in @(
        'RuleID', 'Description', 'StartLine', 'EndLine', 'StartColumn', 'EndColumn',
        'Match', 'Secret', 'File', 'SymlinkFile', 'Commit', 'Entropy', 'Author',
        'Email', 'Date', 'Message', 'Tags', 'Fingerprint', 'Link'
    )) {
        [void]$allowedProperties.Add($name)
    }

    $findings = [System.Collections.Generic.List[object]]::new()
    try {
        if ($document.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
            Stop-SafeValidation 'GL-RAW-SCHEMA'
        }

        foreach ($element in $document.RootElement.EnumerateArray()) {
            if ($element.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
                Stop-SafeValidation 'GL-RAW-SCHEMA'
            }

            foreach ($property in $element.EnumerateObject()) {
                if (-not $allowedProperties.Contains($property.Name)) {
                    Stop-SafeValidation 'GL-RAW-SCHEMA'
                }
            }

            $ruleId = Get-RequiredJsonString -Element $element -Name 'RuleID'
            $rawPath = Get-RequiredJsonString -Element $element -Name 'File'
            $secret = Get-RequiredJsonString -Element $element -Name 'Secret'
            $match = Get-RequiredJsonString -Element $element -Name 'Match'
            $rawCommit = Get-RequiredJsonString -Element $element -Name 'Commit'

            if ($ruleId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') {
                Stop-SafeValidation 'GL-RULE-SCHEMA'
            }
            if ($secret -notmatch '^(?i:REDACTED|\*+)$') {
                Stop-SafeValidation 'GL-REDACTION'
            }
            if (
                [string]::IsNullOrEmpty($match) -or
                ($match.IndexOf($secret, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -and
                 $match -notmatch '(?i:REDACTED|\*{3,})')
            ) {
                Stop-SafeValidation 'GL-REDACTION'
            }

            $safePath = Convert-ToSafeFindingPath -RawPath $rawPath -Repository $Repository
            if ($Scope -eq 'history') {
                if ($rawCommit -notmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') {
                    Stop-SafeValidation 'GL-COMMIT-SCHEMA'
                }
                $commit = $rawCommit.ToLowerInvariant()
                if (-not $ReachableCommits.Contains($commit)) {
                    Stop-SafeValidation 'GL-COMMIT-BOUNDARY'
                }
            }
            else {
                if (
                    -not [string]::IsNullOrEmpty($rawCommit) -and
                    -not $rawCommit.Equals($CandidateCommit, [System.StringComparison]::OrdinalIgnoreCase)
                ) {
                    Stop-SafeValidation 'GL-COMMIT-BOUNDARY'
                }
                $commit = $CandidateCommit.ToLowerInvariant()
            }

            [void]$findings.Add([pscustomobject]@{
                scope   = $Scope
                rule_id = $ruleId
                path    = $safePath
                commit  = $commit
            })
        }
    }
    finally {
        $document.Dispose()
    }

    return $findings
}

function Invoke-GitleaksScan {
    param(
        [Parameter(Mandatory = $true)][string]$Scanner,
        [Parameter(Mandatory = $true)][ValidateSet('history', 'tree')][string]$Scope,
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$RawReportPath
    )

    $arguments = [System.Collections.Generic.List[string]]::new()
    [void]$arguments.Add($(if ($Scope -eq 'history') { 'git' } else { 'dir' }))
    if ($Scope -eq 'history') {
        [void]$arguments.Add('--log-opts=--all')
    }
    foreach ($argument in @(
        '--redact=100',
        '--max-decode-depth=5',
        '--report-format=json',
        '--no-banner',
        '--no-color',
        '--log-level=fatal',
        '--ignore-gitleaks-allow',
        "--exit-code=$findingExitCode",
        "--report-path=$RawReportPath",
        '.'
    )) {
        [void]$arguments.Add($argument)
    }

    $result = Invoke-CapturedProcess -FilePath $Scanner -Arguments $arguments.ToArray() -WorkingDirectory $Repository
    if ($result.ExitCode -notin @(0, $findingExitCode)) {
        Stop-SafeValidation 'GL-SCANNER-EXECUTION'
    }
    return $result.ExitCode
}

try {
    $scannerPath = (Resolve-Path -LiteralPath $GitleaksPath).Path
    if (-not (Test-Path -LiteralPath $scannerPath -PathType Leaf)) {
        Stop-SafeValidation 'GL-SCANNER-PATH'
    }

    $repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
    if (-not (Test-Path -LiteralPath $repository -PathType Container)) {
        Stop-SafeValidation 'GL-REPOSITORY-PATH'
    }
    $repository = Get-CanonicalPath $repository

    $reportedRoot = Invoke-GitText -Repository $repository -Arguments @('rev-parse', '--show-toplevel')
    if (-not (Get-CanonicalPath $reportedRoot).Equals($repository, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-SafeValidation 'GL-REPOSITORY-ROOT'
    }

    $candidateCommit = (Invoke-GitText -Repository $repository -Arguments @('rev-parse', 'HEAD')).ToLowerInvariant()
    if (-not $candidateCommit.Equals($ExpectedCandidateCommit.ToLowerInvariant(), [System.StringComparison]::Ordinal)) {
        Stop-SafeValidation 'GL-CANDIDATE-MISMATCH'
    }

    $status = Invoke-GitText -Repository $repository -Arguments @(
        'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'
    )
    if (-not [string]::IsNullOrEmpty($status)) {
        Stop-SafeValidation 'GL-WORKTREE-DIRTY'
    }

    $repositoryRootFiles = @(Get-ChildItem -LiteralPath $repository -Force -File)
    if ($repositoryRootFiles | Where-Object { $_.Name -ieq '.gitleaks.toml' -or $_.Name -ieq '.gitleaksignore' }) {
        Stop-SafeValidation 'GL-CONFIG-OVERRIDE'
    }
    if (Get-ChildItem Env: | Where-Object { $_.Name -like 'GITLEAKS_*' }) {
        Stop-SafeValidation 'GL-CONFIG-OVERRIDE'
    }

    $versionResult = Invoke-CapturedProcess -FilePath $scannerPath -Arguments @('version') -WorkingDirectory $repository
    if ($versionResult.ExitCode -ne 0 -or $versionResult.Stdout.Trim() -ne $expectedScannerVersion) {
        Stop-SafeValidation 'GL-SCANNER-VERSION'
    }

    $safeReportFinalPath = Get-CanonicalPath $ReportPath
    $reportParent = Split-Path -Parent $safeReportFinalPath
    if (
        [string]::IsNullOrWhiteSpace($reportParent) -or
        -not (Test-Path -LiteralPath $reportParent -PathType Container) -or
        (Test-IsPathInside -Candidate $safeReportFinalPath -Parent $repository) -or
        (Test-Path -LiteralPath $safeReportFinalPath)
    ) {
        Stop-SafeValidation 'GL-REPORT-PATH'
    }

    $tempRoot = Get-CanonicalPath ([System.IO.Path]::GetTempPath())
    $tempDirectory = Join-Path $tempRoot ('BlockXOne-Gitleaks-' + [guid]::NewGuid().ToString('N'))
    if ((Test-IsPathInside -Candidate $tempDirectory -Parent $repository) -or (Test-Path -LiteralPath $tempDirectory)) {
        Stop-SafeValidation 'GL-TEMP-PATH'
    }
    [void](New-Item -ItemType Directory -Path $tempDirectory)

    $historyRawReport = Join-Path $tempDirectory 'history.json'
    $treeRawReport = Join-Path $tempDirectory 'tree.json'

    $reachableCommits = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $commitLines = @((Invoke-GitText -Repository $repository -Arguments @('rev-list', '--all')).Split(
        "`n",
        [System.StringSplitOptions]::RemoveEmptyEntries
    ))
    foreach ($commitLine in $commitLines) {
        $commit = $commitLine.Trim().ToLowerInvariant()
        if ($commit -notmatch '^(?:[0-9a-f]{40}|[0-9a-f]{64})$') {
            Stop-SafeValidation 'GL-COMMIT-SCHEMA'
        }
        [void]$reachableCommits.Add($commit)
    }
    if (-not $reachableCommits.Contains($candidateCommit)) {
        Stop-SafeValidation 'GL-COMMIT-BOUNDARY'
    }

    $historyExit = Invoke-GitleaksScan -Scanner $scannerPath -Scope history -Repository $repository -RawReportPath $historyRawReport
    $treeExit = Invoke-GitleaksScan -Scanner $scannerPath -Scope tree -Repository $repository -RawReportPath $treeRawReport

    $historyFindings = @(Read-RedactedFindings -RawReportPath $historyRawReport -Scope history -Repository $repository -CandidateCommit $candidateCommit -ReachableCommits $reachableCommits)
    $treeFindings = @(Read-RedactedFindings -RawReportPath $treeRawReport -Scope tree -Repository $repository -CandidateCommit $candidateCommit -ReachableCommits $reachableCommits)

    if (
        (($historyExit -eq $findingExitCode) -ne ($historyFindings.Count -gt 0)) -or
        (($treeExit -eq $findingExitCode) -ne ($treeFindings.Count -gt 0))
    ) {
        Stop-SafeValidation 'GL-FINDING-COUNT'
    }

    $allFindings = [System.Collections.Generic.List[object]]::new()
    foreach ($finding in $historyFindings) {
        [void]$allFindings.Add($finding)
    }
    foreach ($finding in $treeFindings) {
        [void]$allFindings.Add($finding)
    }

    $groupedFindings = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    foreach ($finding in $allFindings) {
        $key = $finding.scope + [char]0 + $finding.rule_id + [char]0 + $finding.path + [char]0 + $finding.commit
        if ($groupedFindings.ContainsKey($key)) {
            $groupedFindings[$key].count++
        }
        else {
            $groupedFindings[$key] = [pscustomobject][ordered]@{
                scope   = $finding.scope
                rule_id = $finding.rule_id
                path    = $finding.path
                commit  = $finding.commit
                count   = 1
            }
        }
    }

    $safeFindings = @($groupedFindings.Values | Sort-Object scope, rule_id, path, commit)
    $safeReport = [ordered]@{
        schema    = 'blockxone-redacted-gitleaks'
        version   = 1
        candidate = $candidateCommit
        scanner   = "gitleaks $expectedScannerVersion"
        findings  = $safeFindings
    }
    $safeJson = $safeReport | ConvertTo-Json -Depth 5

    $safeReportStagingPath = Join-Path $reportParent (
        '.' + (Split-Path -Leaf $safeReportFinalPath) + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    )
    if (Test-Path -LiteralPath $safeReportStagingPath) {
        Stop-SafeValidation 'GL-REPORT-PATH'
    }
    [System.IO.File]::WriteAllText($safeReportStagingPath, $safeJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $safeReportStagingPath -Destination $safeReportFinalPath
    $safeReportStagingPath = $null

    if ($safeFindings.Count -gt 0) {
        Write-Host "Redacted Gitleaks scan rejected candidate: $($safeFindings.Count) grouped finding(s)."
        $failureCode = 'GL-FINDINGS'
        throw [System.InvalidOperationException]::new($failureCode)
    }

    Write-Host 'Redacted Gitleaks scan valid: history and checked tree contain zero findings.'
}
catch {
    if ([string]::IsNullOrEmpty($failureCode)) {
        if ($_.Exception.Message -match '^GL-[A-Z0-9-]+$') {
            $failureCode = $_.Exception.Message
        }
        else {
            $failureCode = 'GL-UNEXPECTED'
        }
    }

    Write-Error "Redacted Gitleaks validation failed ($failureCode)."
    if ($failureCode -eq 'GL-FINDINGS') {
        exit 1
    }
    exit 2
}
finally {
    if ($null -ne $safeReportStagingPath -and (Test-Path -LiteralPath $safeReportStagingPath -PathType Leaf)) {
        $stagingParent = Get-CanonicalPath (Split-Path -Parent $safeReportStagingPath)
        $expectedParent = Get-CanonicalPath (Split-Path -Parent $safeReportFinalPath)
        if ($stagingParent.Equals($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $safeReportStagingPath -Force
        }
    }

    if ($null -ne $tempDirectory -and (Test-Path -LiteralPath $tempDirectory -PathType Container)) {
        $tempRoot = Get-CanonicalPath ([System.IO.Path]::GetTempPath())
        $tempParent = Get-CanonicalPath (Split-Path -Parent $tempDirectory)
        $tempLeaf = Split-Path -Leaf $tempDirectory
        if (
            $tempParent.Equals($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
            $tempLeaf -match '^BlockXOne-Gitleaks-[0-9a-f]{32}$'
        ) {
            Remove-Item -LiteralPath $tempDirectory -Recurse -Force
        }
    }
}
