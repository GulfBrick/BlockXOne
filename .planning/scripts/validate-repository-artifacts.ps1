[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$ascii = [System.Text.Encoding]::ASCII
$pathRegexOptions =
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
$lfsPointerInspectionLimit = 1KB
$attributeInspectionLimit = 64KB

function Invoke-GitBytes {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [byte[]]$StandardInput
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = 'git'
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment['GIT_NO_REPLACE_OBJECTS'] = '1'
    $startInfo.Environment['GIT_NO_LAZY_FETCH'] = '1'

    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stdout = [System.IO.MemoryStream]::new()
    $stderr = [System.IO.MemoryStream]::new()

    try {
        if (-not $process.Start()) {
            throw 'Could not start Git.'
        }

        $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdout)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync($stderr)

        if ($null -ne $StandardInput -and $StandardInput.Length -gt 0) {
            $process.StandardInput.BaseStream.Write($StandardInput, 0, $StandardInput.Length)
        }
        $process.StandardInput.Close()

        $process.WaitForExit()
        $stdoutTask.GetAwaiter().GetResult()
        $stderrTask.GetAwaiter().GetResult()

        if ($process.ExitCode -ne 0) {
            throw "Git metadata command failed with exit code $($process.ExitCode)."
        }

        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout   = $stdout.ToArray()
        }
    }
    finally {
        $stdout.Dispose()
        $stderr.Dispose()
        $process.Dispose()
    }
}

function Split-NulRecords {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $start = 0
    for ($index = 0; $index -lt $Bytes.Length; $index++) {
        if ($Bytes[$index] -ne 0) {
            continue
        }

        $length = $index - $start
        if ($length -le 0) {
            throw 'Git returned an empty NUL-delimited record.'
        }

        $record = [byte[]]::new($length)
        [System.Array]::Copy($Bytes, $start, $record, 0, $length)
        Write-Output -NoEnumerate $record
        $start = $index + 1
    }

    if ($start -ne $Bytes.Length) {
        throw 'Git returned a non-terminated NUL-delimited record.'
    }
}

function Convert-PathBytes {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][int]$Offset,
        [Parameter(Mandatory = $true)][int]$Count
    )

    try {
        return $utf8.GetString($Bytes, $Offset, $Count)
    }
    catch {
        throw 'A Git path is not valid UTF-8; repository admission fails closed.'
    }
}

function Get-LeafName {
    param([Parameter(Mandatory = $true)][string]$Path)

    $parts = $Path.Replace('\', '/') -split '/'
    return $parts[$parts.Count - 1]
}

function Test-ProhibitedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $normalized = $Path.Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $true
    }

    $components = @($normalized.Split('/'))
    for ($index = 0; $index -lt $components.Count; $index++) {
        $component = $components[$index]
        if (
            [string]::IsNullOrWhiteSpace($component) -or
            $component -in @('.', '..') -or
            $component -match '[\x00-\x1f\x7f]' -or
            $component.EndsWith(' ', [System.StringComparison]::Ordinal) -or
            $component.EndsWith('.', [System.StringComparison]::Ordinal)
        ) {
            return $true
        }

        if ([regex]::IsMatch($component, '^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$', $pathRegexOptions)) {
            return $true
        }

        $allowedEnvironmentExample = [regex]::IsMatch(
            $component,
            '^\.env(?:\..+)?\.(?:example|sample|template)$',
            $pathRegexOptions
        )
        if (
            [regex]::IsMatch($component, '^\.env(?:\..+)?$', $pathRegexOptions) -and
            ($index -lt ($components.Count - 1) -or -not $allowedEnvironmentExample)
        ) {
            return $true
        }
    }

    $leaf = Get-LeafName $normalized
    if ([regex]::IsMatch($leaf, '\.(?:exe|dll|zip|7z|rar|tar|gz|tgz|bz2|xz|pem|key|p12|pfx|log)$', $pathRegexOptions)) {
        return $true
    }

    if ([regex]::IsMatch($normalized, '(^|/)(?:node_modules|\.next|\.agents|\.claude|\.claude-flow|\.codex)(/|$)', $pathRegexOptions)) {
        return $true
    }

    if ([regex]::IsMatch($leaf, '^\.lfsconfig$', $pathRegexOptions)) {
        return $true
    }

    return $false
}

function Convert-ToEscapedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return ($Path.Replace('\', '/') | ConvertTo-Json -Compress)
}

function Add-PathViolation {
    param([Parameter(Mandatory = $true)][string]$Path)

    [void]$violations.Add($Path.Replace('\', '/'))
}

function Add-BlobPath {
    param(
        [Parameter(Mandatory = $true)][string]$ObjectId,
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not $blobPaths.ContainsKey($ObjectId)) {
        $blobPaths[$ObjectId] = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
    }
    [void]$blobPaths[$ObjectId].Add($Path.Replace('\', '/'))
}

function Test-TreeEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Type,
        [Parameter(Mandatory = $true)][string]$ObjectId,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $normalized = $Path.Replace('\', '/')
    $pathProhibited = Test-ProhibitedPath $normalized
    $modeAllowed = $Mode -in @('100644', '100755')
    $typeAllowed = $Type -eq 'blob'

    if ($pathProhibited -or -not $modeAllowed -or -not $typeAllowed) {
        Add-PathViolation $normalized
        if ($Type -eq 'blob') {
            [void]$contentInspectionExclusions.Add($ObjectId)
        }
        return
    }

    Add-BlobPath -ObjectId $ObjectId -Path $normalized
}

function Read-LsTreeRecords {
    param([Parameter(Mandatory = $true)][string]$Commit)

    $result = Invoke-GitBytes -Arguments @('ls-tree', '-rz', '--full-tree', $Commit)
    foreach ($record in @(Split-NulRecords $result.Stdout)) {
        $tabIndex = [System.Array]::IndexOf($record, [byte]9)
        if ($tabIndex -le 0 -or $tabIndex -ge ($record.Length - 1)) {
            throw 'Git returned a malformed ls-tree record.'
        }

        $metadata = $ascii.GetString($record, 0, $tabIndex)
        if ($metadata -notmatch '^(?<mode>[0-7]{6}) (?<type>blob|tree|commit) (?<oid>[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') {
            throw 'Git returned unsupported ls-tree metadata.'
        }

        $path = Convert-PathBytes -Bytes $record -Offset ($tabIndex + 1) -Count ($record.Length - $tabIndex - 1)
        Test-TreeEntry -Mode $Matches.mode -Type $Matches.type -ObjectId $Matches.oid.ToLowerInvariant() -Path $path
    }
}

function Read-IndexRecords {
    $result = Invoke-GitBytes -Arguments @('ls-files', '--stage', '-z')
    foreach ($record in @(Split-NulRecords $result.Stdout)) {
        $tabIndex = [System.Array]::IndexOf($record, [byte]9)
        if ($tabIndex -le 0 -or $tabIndex -ge ($record.Length - 1)) {
            throw 'Git returned a malformed index record.'
        }

        $metadata = $ascii.GetString($record, 0, $tabIndex)
        if ($metadata -notmatch '^(?<mode>[0-7]{6}) (?<oid>[0-9a-fA-F]{40}|[0-9a-fA-F]{64}) (?<stage>[0-3])$') {
            throw 'Git returned unsupported index metadata.'
        }

        $path = Convert-PathBytes -Bytes $record -Offset ($tabIndex + 1) -Count ($record.Length - $tabIndex - 1)
        [void]$workingPaths.Add($path.Replace('\', '/'))

        if ($Matches.stage -ne '0') {
            Add-PathViolation $path
            [void]$contentInspectionExclusions.Add($Matches.oid.ToLowerInvariant())
            continue
        }

        Test-TreeEntry -Mode $Matches.mode -Type 'blob' -ObjectId $Matches.oid.ToLowerInvariant() -Path $path
    }
}

function Get-ReachableCommits {
    $result = Invoke-GitBytes -Arguments @('rev-list', '--topo-order', 'HEAD')
    $text = $ascii.GetString($result.Stdout).Replace("`r", '')
    $commits = @($text.Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries))
    if ($commits.Count -eq 0) {
        throw 'HEAD has no reachable commits.'
    }

    foreach ($commit in $commits) {
        if ($commit -notmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') {
            throw 'Git returned an invalid commit identifier.'
        }
    }

    return $commits
}

function Test-LfsSignals {
    $objectIds = @($blobPaths.Keys | Where-Object { -not $contentInspectionExclusions.Contains($_) } | Sort-Object)
    if ($objectIds.Count -eq 0) {
        return
    }

    $input = $ascii.GetBytes(($objectIds -join "`n") + "`n")
    $sizeResult = Invoke-GitBytes -Arguments @('cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)') -StandardInput $input
    $sizeLines = @($ascii.GetString($sizeResult.Stdout).Replace("`r", '').Split("`n", [System.StringSplitOptions]::RemoveEmptyEntries))
    if ($sizeLines.Count -ne $objectIds.Count) {
        throw 'Git returned an incomplete object-size inventory.'
    }

    $candidateObjectIds = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $objectIds.Count; $index++) {
        if ($sizeLines[$index] -notmatch '^(?<oid>[0-9a-fA-F]{40}|[0-9a-fA-F]{64}) (?<type>\S+) (?<size>\d+)$') {
            throw 'Git returned malformed object-size metadata.'
        }
        if ($Matches.oid -ine $objectIds[$index] -or $Matches.type -ne 'blob') {
            throw 'Git returned unexpected object-size metadata.'
        }

        $size = [int64]$Matches.size
        $attributePaths = @($blobPaths[$objectIds[$index]] | Where-Object {
            (Get-LeafName $_) -ieq '.gitattributes'
        })

        if ($attributePaths.Count -gt 0 -and $size -le $attributeInspectionLimit) {
            [void]$candidateObjectIds.Add($objectIds[$index])
        }
        elseif ($attributePaths.Count -gt 0) {
            foreach ($path in $attributePaths) {
                Add-PathViolation $path
            }
        }
        elseif ($size -le $lfsPointerInspectionLimit) {
            [void]$candidateObjectIds.Add($objectIds[$index])
        }
    }

    if ($candidateObjectIds.Count -eq 0) {
        return
    }

    $contentInput = $ascii.GetBytes(($candidateObjectIds -join "`n") + "`n")
    $contentResult = Invoke-GitBytes -Arguments @('cat-file', '--batch') -StandardInput $contentInput
    $offset = 0

    foreach ($expectedObjectId in $candidateObjectIds) {
        $lineEnd = $offset
        while ($lineEnd -lt $contentResult.Stdout.Length -and $contentResult.Stdout[$lineEnd] -ne 10) {
            $lineEnd++
        }
        if ($lineEnd -ge $contentResult.Stdout.Length) {
            throw 'Git returned a malformed object-content header.'
        }

        $header = $ascii.GetString($contentResult.Stdout, $offset, $lineEnd - $offset)
        if ($header -notmatch '^(?<oid>[0-9a-fA-F]{40}|[0-9a-fA-F]{64}) blob (?<size>\d+)$') {
            throw 'Git returned unsupported object-content metadata.'
        }
        if ($Matches.oid -ine $expectedObjectId) {
            throw 'Git returned object content out of order.'
        }

        $contentLength = [int]$Matches.size
        $offset = $lineEnd + 1
        if ($contentLength -gt $attributeInspectionLimit -or ($offset + $contentLength) -ge $contentResult.Stdout.Length) {
            throw 'Git returned an invalid object-content length.'
        }

        $content = [byte[]]::new($contentLength)
        if ($contentLength -gt 0) {
            [System.Array]::Copy($contentResult.Stdout, $offset, $content, 0, $contentLength)
        }
        $offset += $contentLength
        if ($contentResult.Stdout[$offset] -ne 10) {
            throw 'Git returned an unterminated object-content record.'
        }
        $offset++

        $text = $ascii.GetString($content).Replace("`r`n", "`n")
        $isLfsPointer =
            $text.StartsWith("version https://git-lfs.github.com/spec/v1`n", [System.StringComparison]::Ordinal) -and
            [regex]::IsMatch($text, '(?m)^oid sha256:[0-9a-fA-F]{64}$', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant) -and
            [regex]::IsMatch($text, '(?m)^size [0-9]+$', [System.Text.RegularExpressions.RegexOptions]::CultureInvariant)

        $hasLfsAttributes = [regex]::IsMatch(
            $text,
            '(?im)(?:^|\s)(?:filter|diff|merge)=lfs(?:\s|$)',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
        )

        foreach ($path in $blobPaths[$expectedObjectId]) {
            if ($isLfsPointer -or ((Get-LeafName $path) -ieq '.gitattributes' -and $hasLfsAttributes)) {
                Add-PathViolation $path
            }
        }
    }

    if ($offset -ne $contentResult.Stdout.Length) {
        throw 'Git returned trailing object-content bytes.'
    }
}

$violations = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$workingPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$contentInspectionExclusions = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$blobPaths = @{}

Push-Location $repoRoot
try {
    Read-IndexRecords

    $commits = @(Get-ReachableCommits)
    foreach ($commit in $commits) {
        Read-LsTreeRecords $commit
    }

    if ($violations.Count -gt 0) {
        Write-Host 'Repository artifact policy rejected these paths:'
        foreach ($path in @($violations | Sort-Object)) {
            Write-Host (Convert-ToEscapedPath $path)
        }
        throw "Repository artifact policy failed for $($violations.Count) path(s)."
    }

    Test-LfsSignals

    if ($violations.Count -gt 0) {
        Write-Host 'Repository artifact policy rejected these paths:'
        foreach ($path in @($violations | Sort-Object)) {
            Write-Host (Convert-ToEscapedPath $path)
        }
        throw "Repository artifact policy failed for $($violations.Count) path(s)."
    }

    Write-Host "Repository artifact policy valid: $($workingPaths.Count) tracked paths across $($commits.Count) HEAD-reachable commit(s); modes, prohibited classes and LFS signals are clean."
}
finally {
    Pop-Location
}
