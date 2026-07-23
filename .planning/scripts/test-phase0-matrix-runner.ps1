[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7 or later is required; found $($PSVersionTable.PSVersion)."
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runnerPath = Join-Path $PSScriptRoot 'invoke-phase0-matrix.ps1'
$planPath = Join-Path $repoRoot '.planning\phases\00-planning-truth-and-containment\00-12-PLAN.md'
$testContractPath = Join-Path $repoRoot '.planning\TEST-CONTRACT.md'
$nodeExecutable = 'C:\Users\danie\AppData\Local\npm-cache\_npx\d295cebdb7c54afe\node_modules\node\bin\node.exe'
$npmCli = 'C:\Users\danie\AppData\Local\npm-cache\_npx\d8f2e63c6145eb9d\node_modules\npm\bin\npm-cli.js'
$goExecutable = 'C:\Users\danie\go\pkg\mod\golang.org\toolchain@v0.0.1-go1.26.5.windows-amd64\bin\go.exe'
$hostileGoDirectory = 'C:\Users\danie\go\pkg\mod\golang.org\toolchain@v0.0.1-go1.25.10.windows-amd64\bin'
$requiredPlanSha256 = 'A702B1F506E23FDF475702A76CB30041F295485DFE1BC922D00B19ADC0B439AC'
$requiredNodeSha256 = 'F8D162C0641DCEE512132F3BCF8A68169C7ECB852EFD8E1A46C9FEC5A0F469ED'
$requiredNpmCliSha256 = '8E5F6F3429F8CDBE693CDC29904E9D5A7B127A494BD15C804BD54C7403BFCBE7'
$requiredGoSha256 = 'D6A71E6DC9806CB3F1FCB817D562175C5A7B1505FC3F6638299648E0B9F0F74F'
$requiredSharpSmokeUtf8Bytes = 720
$requiredSharpSmokeSha256 = '99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3'
$requiredSharpSmokeScript = @'
(async()=>{const sharp=require('./apps/web/node_modules/sharp');const pixel=[255,0,0,255];const input=Buffer.from(Array(6).fill(pixel).flat());const png=await sharp(input,{raw:{width:2,height:3,channels:4}}).png().toBuffer();const meta=await sharp(png).metadata();const versions=sharp.versions;if(png.length!==95||meta.format!=='png'||meta.width!==2||meta.height!==3||versions.sharp!=='0.35.3'||versions.vips!=='8.18.3')throw new Error(JSON.stringify({bytes:png.length,meta,versions}));console.log(`SHARP_SMOKE_PASS|fixture=solid-red-rgba|bytes=${png.length}|format=${meta.format}|width=${meta.width}|height=${meta.height}|sharp=${versions.sharp}|vips=${versions.vips}`)})().catch(e=>{console.error(e);process.exit(1)});
'@
$pwshExecutable = [System.Environment]::ProcessPath
$gitExecutable = @(
    Get-Command -Name 'git.exe' -CommandType Application -All -ErrorAction Stop |
        ForEach-Object Source |
        Sort-Object -Unique
)
if ($gitExecutable.Count -ne 1) {
    throw "Expected one canonical git.exe for runner tests; found=[$($gitExecutable -join ', ')]"
}
$gitExecutable = $gitExecutable[0]

$expectedToolLabels = @(
    'tool.node.version'
    'tool.npm.version'
    'tool.go.version'
    'tool.go.toolchain-env'
    'tool.actionlint.version'
    'tool.golangci-lint.version'
    'tool.gosec.module'
    'tool.govulncheck.version'
    'tool.docker.version'
    'tool.git.version'
    'runner.tests'
)
$expectedMatrixLabels = @(
    'planning.validate'
    'artifacts.validate'
    'ci-policy.validate'
    'compose-policy.validate'
    'workflows.actionlint'
    'go.module-verify'
    'go.test'
    'go.test.discovery'
    'go.vet'
    'go.lint'
    'go.gosec'
    'go.govulncheck'
    'web.install'
    'web.sharp-smoke'
    'web.preflight-tests'
    'web.config-tests'
    'web.runner-tests'
    'web.unit.repo-root'
    'web.unit.package-root'
    'web.lint'
    'web.audit.full.pre-build'
    'web.audit.runtime.pre-build'
    'web.build'
    'web.production-containment'
    'web.audit.full.post-containment'
    'web.audit.runtime.post-containment'
    'contracts.install'
    'contracts.preflight-tests'
    'contracts.compile'
    'contracts.typecheck'
    'contracts.test.full'
    'contracts.test.identity'
    'contracts.test.token'
    'contracts.test.factory'
    'contracts.audit.runtime'
    'contracts.audit.full'
    'bytecode.compare'
    'compose.render.raw'
    'repository.status.ignored-aware'
)
$expectedSemanticParserBindings = @(
    [pscustomobject]@{ Label = 'tool.node.version'; Parser = 'Assert-ExactOutputLine' }
    [pscustomobject]@{ Label = 'tool.npm.version'; Parser = 'Assert-ExactOutputLine' }
    [pscustomobject]@{ Label = 'tool.go.version'; Parser = 'Assert-GoVersionIdentity' }
    [pscustomobject]@{ Label = 'tool.go.toolchain-env'; Parser = 'Assert-ExactOutputLine' }
    [pscustomobject]@{ Label = 'tool.actionlint.version'; Parser = 'Assert-ActionlintIdentity' }
    [pscustomobject]@{ Label = 'tool.golangci-lint.version'; Parser = 'Assert-GolangciIdentity' }
    [pscustomobject]@{ Label = 'tool.gosec.module'; Parser = 'Assert-GosecModuleIdentity' }
    [pscustomobject]@{ Label = 'tool.govulncheck.version'; Parser = 'Assert-GovulncheckIdentity' }
    [pscustomobject]@{ Label = 'tool.docker.version'; Parser = 'Assert-DockerIdentity' }
    [pscustomobject]@{ Label = 'tool.git.version'; Parser = 'Assert-GitIdentity' }
    [pscustomobject]@{ Label = 'runner.tests'; Parser = 'Assert-RunnerTestsOutput' }
    [pscustomobject]@{ Label = 'planning.validate'; Parser = 'Assert-PlanningValidatorOutput' }
    [pscustomobject]@{ Label = 'artifacts.validate'; Parser = 'Assert-ArtifactValidatorOutput' }
    [pscustomobject]@{ Label = 'ci-policy.validate'; Parser = 'Assert-CiPolicyOutput' }
    [pscustomobject]@{ Label = 'compose-policy.validate'; Parser = 'Assert-ComposePolicyOutput' }
    [pscustomobject]@{ Label = 'workflows.actionlint'; Parser = 'Assert-ZeroRawOutput' }
    [pscustomobject]@{ Label = 'go.module-verify'; Parser = 'Assert-ExactOutputLine' }
    [pscustomobject]@{ Label = 'go.test.discovery'; Parser = 'Assert-GoDiscovery' }
    [pscustomobject]@{ Label = 'go.vet'; Parser = 'Assert-ZeroRawOutput' }
    [pscustomobject]@{ Label = 'go.lint'; Parser = 'Assert-GolangciZeroIssues' }
    [pscustomobject]@{ Label = 'go.gosec'; Parser = 'Assert-GosecZeroIssues' }
    [pscustomobject]@{ Label = 'go.govulncheck'; Parser = 'Assert-GovulnReachableZero' }
    [pscustomobject]@{ Label = 'web.install'; Parser = 'Assert-NpmInstallSummary' }
    [pscustomobject]@{ Label = 'web.sharp-smoke'; Parser = 'Assert-ExactOutputLine' }
    [pscustomobject]@{ Label = 'web.preflight-tests'; Parser = 'Assert-TapSummary' }
    [pscustomobject]@{ Label = 'web.config-tests'; Parser = 'Assert-TapSummary' }
    [pscustomobject]@{ Label = 'web.runner-tests'; Parser = 'Assert-TapSummary' }
    [pscustomobject]@{ Label = 'web.unit.repo-root'; Parser = 'Assert-VitestSummary' }
    [pscustomobject]@{ Label = 'web.unit.package-root'; Parser = 'Assert-VitestSummary' }
    [pscustomobject]@{ Label = 'web.lint'; Parser = 'Assert-WebLintSummary' }
    [pscustomobject]@{ Label = 'web.audit.full.pre-build'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'web.audit.runtime.pre-build'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'web.build'; Parser = 'Assert-NextBuildSummary' }
    [pscustomobject]@{ Label = 'web.production-containment'; Parser = 'Assert-ProductionContainmentOutput' }
    [pscustomobject]@{ Label = 'web.audit.full.post-containment'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'web.audit.runtime.post-containment'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'contracts.install'; Parser = 'Assert-NpmInstallSummary' }
    [pscustomobject]@{ Label = 'contracts.preflight-tests'; Parser = 'Assert-TapSummary' }
    [pscustomobject]@{ Label = 'contracts.compile'; Parser = 'Assert-HardhatCompileSummary' }
    [pscustomobject]@{ Label = 'contracts.typecheck'; Parser = 'Assert-ContractsPreflightOutput' }
    [pscustomobject]@{ Label = 'contracts.test.full'; Parser = 'Assert-HardhatTestSummary' }
    [pscustomobject]@{ Label = 'contracts.test.identity'; Parser = 'Assert-HardhatTestSummary' }
    [pscustomobject]@{ Label = 'contracts.test.token'; Parser = 'Assert-HardhatTestSummary' }
    [pscustomobject]@{ Label = 'contracts.test.factory'; Parser = 'Assert-HardhatTestSummary' }
    [pscustomobject]@{ Label = 'contracts.audit.runtime'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'contracts.audit.full'; Parser = 'Assert-NpmAuditZero' }
    [pscustomobject]@{ Label = 'bytecode.compare'; Parser = 'Assert-BytecodeComparatorOutput' }
    [pscustomobject]@{ Label = 'compose.render.raw'; Parser = 'Assert-ZeroRawOutput' }
    [pscustomobject]@{ Label = 'repository.status.ignored-aware'; Parser = 'Assert-ZeroRawOutput' }
)
$semanticParserNames = @(
    $expectedSemanticParserBindings |
        ForEach-Object Parser |
        Sort-Object -Unique
)
$expectedGoTestedPackages = @(
    'blockxone/cmd/api'
    'blockxone/cmd/seed'
    'blockxone/internal/auth'
    'blockxone/internal/chain'
    'blockxone/internal/config'
    'blockxone/internal/ethsig'
    'blockxone/internal/middleware'
    'blockxone/internal/migrate'
    'blockxone/internal/monitoring'
    'blockxone/internal/payments'
    'blockxone/internal/policy'
    'blockxone/internal/releasepolicy'
)
$expectedGoNoTestPackages = @(
    'blockxone/cmd/migrate'
    'blockxone/cmd/worker'
    'blockxone/internal/app'
    'blockxone/internal/audit'
    'blockxone/internal/chainlog'
    'blockxone/internal/custody'
    'blockxone/internal/db'
    'blockxone/internal/events'
    'blockxone/internal/examples'
    'blockxone/internal/kyc'
    'blockxone/internal/logging'
    'blockxone/internal/rbac'
    'blockxone/scripts'
)
$expectedWebLintTranscript = @(
    ''
    '> @blockxone/web@1.0.0 prelint'
    '> npm run preflight'
    ''
    ''
    '> @blockxone/web@1.0.0 preflight'
    '> node scripts/preflight.mjs'
    ''
    'Web toolchain preflight passed with Node 22.23.1 and npm 10.9.8.'
    ''
    '> @blockxone/web@1.0.0 lint'
    '> next lint'
    ''
    '`next lint` is deprecated and will be removed in Next.js 16.'
    'For new projects, use create-next-app to choose your preferred linter.'
    'For existing projects, migrate to the ESLint CLI:'
    'npx @next/codemod@canary next-lint-to-eslint-cli .'
    ''
    '✔ No ESLint warnings or errors'
)

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-TextUtf8Sha256 {
    param([Parameter(Mandatory)][string]$Text)

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    return [System.Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($utf8.GetBytes($Text))
    )
}

function Get-TestEncodingBytesProbe {
    param(
        [Parameter(Mandatory)][System.Text.Encoding]$Encoding,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text
    )

    try {
        return "ok:$([System.Convert]::ToHexString($Encoding.GetBytes($Text)))"
    }
    catch {
        return "error:$($_.Exception.GetType().AssemblyQualifiedName)"
    }
}

function Get-TestEncodingTextProbe {
    param(
        [Parameter(Mandatory)][System.Text.Encoding]$Encoding,
        [Parameter(Mandatory)][byte[]]$Bytes
    )

    try {
        $decoded = $Encoding.GetString($Bytes)
        $codeUnits = @(
            $decoded.ToCharArray() |
                ForEach-Object {
                    ([int][char]$_).ToString(
                        'X4',
                        [System.Globalization.CultureInfo]::InvariantCulture
                    )
                }
        )
        return "ok:$($codeUnits -join '-')"
    }
    catch {
        return "error:$($_.Exception.GetType().AssemblyQualifiedName)"
    }
}

function Get-TestEncodingFingerprint {
    param([Parameter(Mandatory)][System.Text.Encoding]$Encoding)

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $encoderReplacement = if ($Encoding.EncoderFallback -is [System.Text.EncoderReplacementFallback]) {
        [System.Convert]::ToHexString(
            $utf8.GetBytes($Encoding.EncoderFallback.DefaultString)
        )
    }
    else {
        ''
    }
    $decoderReplacement = if ($Encoding.DecoderFallback -is [System.Text.DecoderReplacementFallback]) {
        [System.Convert]::ToHexString(
            $utf8.GetBytes($Encoding.DecoderFallback.DefaultString)
        )
    }
    else {
        ''
    }
    return @(
        "code_page=$($Encoding.CodePage)"
        "web_name=$($Encoding.WebName)"
        "body_name=$($Encoding.BodyName)"
        "header_name=$($Encoding.HeaderName)"
        "encoding_name=$($Encoding.EncodingName)"
        "windows_code_page=$($Encoding.WindowsCodePage)"
        "single_byte=$($Encoding.IsSingleByte)"
        "preamble=$([System.Convert]::ToHexString($Encoding.GetPreamble()))"
        "encoder_fallback=$($Encoding.EncoderFallback.GetType().AssemblyQualifiedName)"
        "encoder_fallback_max=$($Encoding.EncoderFallback.MaxCharCount)"
        "encoder_replacement_utf8=$encoderReplacement"
        "decoder_fallback=$($Encoding.DecoderFallback.GetType().AssemblyQualifiedName)"
        "decoder_fallback_max=$($Encoding.DecoderFallback.MaxCharCount)"
        "decoder_replacement_utf8=$decoderReplacement"
        "encode_u2714=$(Get-TestEncodingBytesProbe -Encoding $Encoding -Text ([string][char]0x2714))"
        "encode_unpaired_d800=$(Get-TestEncodingBytesProbe -Encoding $Encoding -Text ([string][char]0xD800))"
        "decode_e29c94=$(Get-TestEncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0xE2, 0x9C, 0x94)))"
        "decode_80=$(Get-TestEncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0x80)))"
    ) -join '|'
}

function New-TestRoot {
    param([Parameter(Mandatory)][string]$Label)

    $temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $candidate = Join-Path $temporaryRoot ("blockxone-phase0-runner-tests-$Label-" + [Guid]::NewGuid().ToString('N'))
    Assert-Condition (-not (Test-Path -LiteralPath $candidate)) "Test root already exists: $candidate"
    [System.IO.Directory]::CreateDirectory($candidate) | Out-Null
    return $candidate
}

function Invoke-TestProcess {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [hashtable]$Environment = @{},
        [bool]$CreateNoWindow = $true,
        [ValidateRange(1, 1800000)]
        [int]$TimeoutMilliseconds = 120000
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $CreateNoWindow
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        $startInfo.ArgumentList.Add($argument)
    }
    foreach ($entry in $Environment.GetEnumerator()) {
        $matchingKeys = @(
            $startInfo.Environment.Keys |
                Where-Object {
                    [string]::Equals(
                        [string]$_,
                        [string]$entry.Key,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                }
        )
        if ($null -eq $entry.Value) {
            foreach ($matchingKey in $matchingKeys) {
                $null = $startInfo.Environment.Remove([string]$matchingKey)
            }
        }
        else {
            $environmentKey = if ($matchingKeys.Count -gt 0) {
                [string]$matchingKeys[0]
            }
            else {
                [string]$entry.Key
            }
            $startInfo.Environment[$environmentKey] = [string]$entry.Value
        }
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    Assert-Condition $process.Start() "Could not start test process: $Executable"
    $process.StandardInput.Close()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $completed = $process.WaitForExit($TimeoutMilliseconds)
    $killError = $null
    if (-not $completed) {
        try {
            $process.Kill($true)
        }
        catch {
            $killError = $_
        }
        $process.WaitForExit()
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $stopwatch.Stop()
    $exitCode = if ($completed) { $process.ExitCode } else { -1 }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Stdout = $stdout
        Stderr = $stderr
        Text = "$stdout`n$stderr"
        TimedOut = -not $completed
        ElapsedMilliseconds = $stopwatch.ElapsedMilliseconds
        KillError = $killError
    }
}

function Invoke-ChildConsoleCodePageProbe {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][int]$ExpectedCodePage,
        [Parameter(Mandatory)][string]$Label
    )

    $result = Invoke-TestProcess `
        -Executable $Executable `
        -Arguments @(
            '-NoProfile',
            '-Command',
            'Write-Output ("CHILD_DOTNET_CP=" + [System.Console]::OutputEncoding.CodePage)'
        ) `
        -WorkingDirectory $repoRoot `
        -CreateNoWindow $false `
        -TimeoutMilliseconds 15000
    Assert-Condition (
        -not $result.TimedOut -and
        $result.ExitCode -eq 0 -and
        $result.Stderr.Length -eq 0 -and
        $result.Stdout.Trim() -ceq "CHILD_DOTNET_CP=$ExpectedCodePage"
    ) "$Label child console-codepage probe failed; timed_out=$($result.TimedOut); elapsed_ms=$($result.ElapsedMilliseconds); exit=$($result.ExitCode); output=$($result.Text)"
    return $ExpectedCodePage
}

function Invoke-RunnerSelfTestProcess {
    param(
        [Parameter(Mandatory)][string]$Case,
        [string]$Runner = $runnerPath,
        [string]$Node = $nodeExecutable,
        [string]$Npm = $npmCli,
        [string]$Go = $goExecutable,
        [hashtable]$Environment = @{},
        [ValidateRange(1, 1800000)]
        [int]$TimeoutMilliseconds = 120000
    )

    return Invoke-TestProcess -Executable $pwshExecutable -WorkingDirectory $repoRoot -Environment $Environment -TimeoutMilliseconds $TimeoutMilliseconds -Arguments @(
        '-NoProfile',
        '-File',
        $Runner,
        '-NodeExecutable',
        $Node,
        '-NpmCli',
        $Npm,
        '-GoExecutable',
        $Go,
        '-SelfTestCase',
        $Case
    )
}

function Assert-ProcessPass {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        -not $Result.TimedOut -and
        $Result.ExitCode -eq 0 -and
        $Result.Text.Contains($Marker)
    ) "$Label failed; timed_out=$($Result.TimedOut); elapsed_ms=$($Result.ElapsedMilliseconds); exit=$($Result.ExitCode); output=$($Result.Text)"
}

function Assert-ProcessFailure {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$Marker,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        -not $Result.TimedOut
    ) "$Label timed out after $($Result.ElapsedMilliseconds) ms; kill_error=$($Result.KillError); output=$($Result.Text)"
    Assert-Condition ($Result.ExitCode -ne 0) "$Label unexpectedly exited zero"
    Assert-Condition (
        $Result.Text.Contains($Marker)
    ) "$Label failed for the wrong reason; expected=$Marker; output=$($Result.Text)"
}

function Get-RepositoryStatus {
    param([switch]$IgnoredAware)

    $arguments = @('-C', $repoRoot, 'status', '--porcelain=v1', '--untracked-files=all')
    if ($IgnoredAware) {
        $arguments += '--ignored=matching'
    }
    $result = Invoke-TestProcess -Executable $gitExecutable -Arguments $arguments -WorkingDirectory $repoRoot
    Assert-Condition ($result.ExitCode -eq 0) "Unable to read repository status: $($result.Text)"
    return $result.Stdout.Replace("`r`n", "`n").TrimEnd("`n")
}

function Get-OwnedFileFingerprint {
    $trackedResult = Invoke-TestProcess -Executable $gitExecutable -Arguments @(
        '-C', $repoRoot, 'ls-files', '-z'
    ) -WorkingDirectory $repoRoot
    Assert-Condition ($trackedResult.ExitCode -eq 0) "Unable to enumerate tracked repository files: $($trackedResult.Text)"
    $paths = [System.Collections.Generic.List[string]]::new()
    foreach ($trackedPath in @($trackedResult.Stdout -split "`0" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        $paths.Add($trackedPath.Replace('/', '\'))
    }
    foreach ($ownedPath in @(
        '.planning/TEST-CONTRACT.md'
        '.planning/scripts/invoke-phase0-matrix.ps1'
        '.planning/scripts/test-phase0-matrix-runner.ps1'
        '.planning/scripts/validate-planning.ps1'
        '.planning/BLOCKERS.md'
        '.planning/EVIDENCE-REGISTER.md'
        '.planning/STATE.md'
        '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md'
        '.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md'
    )) {
        $normalizedOwnedPath = $ownedPath.Replace('/', '\')
        if (-not $paths.Contains($normalizedOwnedPath)) {
            $paths.Add($normalizedOwnedPath)
        }
    }
    $map = [ordered]@{}
    foreach ($path in @($paths | Sort-Object -Unique)) {
        $fullPath = Join-Path $repoRoot $path
        Assert-Condition (Test-Path -LiteralPath $fullPath -PathType Leaf) "Owned runner-test input is missing: $path"
        $map[$path] = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
    }
    return $map
}

function Assert-FingerprintEqual {
    param(
        [Parameter(Mandatory)][object]$Before,
        [Parameter(Mandatory)][object]$After
    )

    Assert-Condition (
        (@($Before.Keys) -join "`n") -ceq (@($After.Keys) -join "`n")
    ) 'Runner tests changed the owned path set'
    foreach ($key in $Before.Keys) {
        Assert-Condition (
            $Before[$key] -ceq $After[$key]
        ) "Runner tests changed repository file bytes: $key"
    }
}

function Get-PlanOwnedArray {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$VariableName
    )

    $pattern = '(?ms)^\$script:' + [regex]::Escape($VariableName) + '\s*=\s*@\((?<body>.*?)^\)'
    $match = [regex]::Match($Source, $pattern)
    Assert-Condition $match.Success "Runner is missing plan-owned array $VariableName"
    return @(
        [regex]::Matches($match.Groups['body'].Value, "(?m)^\s*'(?<value>[^']+)'\s*$") |
            ForEach-Object { $_.Groups['value'].Value }
    )
}

function Assert-SequenceEqual {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Actual,
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Expected,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        $Actual.Count -eq $Expected.Count -and
        ($Actual -join "`n") -ceq ($Expected -join "`n")
    ) "$Label differs; expected=[$($Expected -join ', ')]; actual=[$($Actual -join ', ')]"
}

function Get-LiteralCheckedLabels {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.Ast]$Scope
    )

    $checkedNames = @(
        'Invoke-NativeChecked',
        'Invoke-NpmChecked',
        'Invoke-GoChecked',
        'Invoke-PwshChecked'
    )
    $labels = [System.Collections.Generic.List[string]]::new()
    $commands = @(
        $Scope.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $checkedNames -contains $node.GetCommandName()
            },
            $true
        )
    )
    foreach ($command in $commands) {
        for ($index = 1; $index -lt ($command.CommandElements.Count - 1); $index++) {
            $element = $command.CommandElements[$index]
            if (
                $element -is [System.Management.Automation.Language.CommandParameterAst] -and
                $element.ParameterName -ceq 'Label'
            ) {
                $value = $command.CommandElements[$index + 1]
                if (
                    $value -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
                    $value.StringConstantType -in @(
                        [System.Management.Automation.Language.StringConstantType]::SingleQuoted,
                        [System.Management.Automation.Language.StringConstantType]::BareWord
                    )
                ) {
                    $labels.Add($value.Value)
                }
            }
        }
    }
    return @($labels)
}

function Get-FunctionAst {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Label
    )

    $matches = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                $node.Name -ceq $Name
            },
            $true
        )
    )
    Assert-Condition ($matches.Count -eq 1) "$Label must define $Name exactly once"
    return $matches[0]
}

function Get-CommandParameterValueAst {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.CommandAst]$Command,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Label
    )

    $values = [System.Collections.Generic.List[System.Management.Automation.Language.CommandElementAst]]::new()
    for ($index = 1; $index -lt ($Command.CommandElements.Count - 1); $index++) {
        $element = $Command.CommandElements[$index]
        if (
            $element -is [System.Management.Automation.Language.CommandParameterAst] -and
            $element.ParameterName -ceq $Name
        ) {
            $values.Add($Command.CommandElements[$index + 1])
        }
    }
    Assert-Condition (
        $values.Count -eq 1
    ) "$Label must bind parameter -$Name exactly once; found=$($values.Count)"
    return $values[0]
}

function Get-EnclosingFunctionName {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.Ast]$Node
    )

    $cursor = $Node
    while ($null -ne $cursor) {
        if ($cursor -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
            return $cursor.Name
        }
        $cursor = $cursor.Parent
    }
    return '<script>'
}

function Get-ContainingAssignmentAst {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.CommandAst]$Command,
        [Parameter(Mandatory)][string]$Label
    )

    $cursor = $Command.Parent
    while (
        $null -ne $cursor -and
        $cursor -isnot [System.Management.Automation.Language.AssignmentStatementAst] -and
        $cursor -isnot [System.Management.Automation.Language.FunctionDefinitionAst] -and
        $cursor -isnot [System.Management.Automation.Language.ScriptBlockAst]
    ) {
        $cursor = $cursor.Parent
    }
    Assert-Condition (
        $cursor -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $cursor.Left -is [System.Management.Automation.Language.VariableExpressionAst]
    ) "$Label must assign its checked result to one direct variable"
    return $cursor
}

function Get-ContainingAssignmentVariableName {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.CommandAst]$Command,
        [Parameter(Mandatory)][string]$Label
    )

    return (
        Get-ContainingAssignmentAst -Command $Command -Label $Label
    ).Left.VariablePath.UserPath
}

function Get-CheckedParserBindings {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string[]]$ParserNames,
        [Parameter(Mandatory)][string]$Label
    )

    $checkedNames = @(
        'Invoke-NativeChecked',
        'Invoke-NpmChecked',
        'Invoke-GoChecked',
        'Invoke-PwshChecked'
    )
    $checked = [System.Collections.Generic.List[object]]::new()
    foreach ($command in @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $checkedNames -contains $node.GetCommandName()
            },
            $true
        )
    )) {
        $labelAst = Get-CommandParameterValueAst -Command $command -Name 'Label' -Label "$Label checked invocation"
        if (
            $labelAst -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -or
            $labelAst.StringConstantType -notin @(
                [System.Management.Automation.Language.StringConstantType]::SingleQuoted,
                [System.Management.Automation.Language.StringConstantType]::BareWord
            )
        ) {
            continue
        }
        $checked.Add([pscustomobject]@{
            Label = [string]$labelAst.Value
            ResultVariable = Get-ContainingAssignmentVariableName -Command $command -Label "$Label label '$($labelAst.Value)'"
            Scope = Get-EnclosingFunctionName -Node $command
            Command = $command
        })
    }

    $parsers = [System.Collections.Generic.List[object]]::new()
    foreach ($command in @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $ParserNames -contains $node.GetCommandName()
            },
            $true
        )
    )) {
        $resultAst = Get-CommandParameterValueAst -Command $command -Name 'Result' -Label "$Label parser '$($command.GetCommandName())'"
        if ($resultAst -isnot [System.Management.Automation.Language.VariableExpressionAst]) {
            continue
        }
        $parsers.Add([pscustomobject]@{
            Parser = [string]$command.GetCommandName()
            ResultVariable = [string]$resultAst.VariablePath.UserPath
            Scope = Get-EnclosingFunctionName -Node $command
            Command = $command
        })
    }

    $bindings = [System.Collections.Generic.List[object]]::new()
    foreach ($invocation in $checked) {
        $nextInvocation = @(
            $checked |
                Where-Object {
                    $_.Scope -ceq $invocation.Scope -and
                    $_.Command.Extent.StartOffset -gt $invocation.Command.Extent.StartOffset
                } |
                Sort-Object { $_.Command.Extent.StartOffset } |
                Select-Object -First 1
        )
        foreach ($parser in @(
            $parsers |
                Where-Object {
                    $_.Scope -ceq $invocation.Scope -and
                    $_.ResultVariable -ceq $invocation.ResultVariable
                }
        )) {
            $bindings.Add([pscustomobject]@{
                Label = $invocation.Label
                Parser = $parser.Parser
                Scope = $invocation.Scope
                ResultVariable = $invocation.ResultVariable
                InvocationCommand = $invocation.Command
                ParserCommand = $parser.Command
                NextInvocationCommand = if ($nextInvocation.Count -eq 1) {
                    $nextInvocation[0].Command
                }
                else {
                    $null
                }
            })
        }
    }
    return @($bindings)
}

function New-FunctionScopedMutation {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$FunctionName,
        [Parameter(Mandatory)][object[]]$Replacements,
        [Parameter(Mandatory)][string]$Label
    )

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $Source,
        [ref]$tokens,
        [ref]$parseErrors
    )
    Assert-Condition (
        $parseErrors.Count -eq 0
    ) "$Label source has PowerShell parse errors: $($parseErrors.Message -join '; ')"
    $function = Get-FunctionAst -Ast $ast -Name $FunctionName -Label $Label
    $mutatedFunction = [string]$function.Extent.Text
    foreach ($replacement in $Replacements) {
        $expectedCount = if ($null -eq $replacement.PSObject.Properties['ExpectedCount']) {
            1
        }
        else {
            [int]$replacement.ExpectedCount
        }
        $actualCount = [regex]::Matches(
            $mutatedFunction,
            [regex]::Escape([string]$replacement.Old),
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        ).Count
        Assert-Condition (
            $actualCount -eq $expectedCount
        ) "$Label mutation target count differs in $FunctionName; expected=$expectedCount; actual=$actualCount; target=$($replacement.Old)"
        $mutatedFunction = $mutatedFunction.Replace(
            [string]$replacement.Old,
            [string]$replacement.New
        )
    }
    $mutatedSource = (
        $Source.Substring(0, $function.Extent.StartOffset) +
        $mutatedFunction +
        $Source.Substring($function.Extent.EndOffset)
    )
    Assert-Condition (
        $mutatedSource -cne $Source
    ) "$Label did not change $FunctionName"
    return $mutatedSource
}

function Get-ProductionOrchestrationAsts {
    param(
        [Parameter(Mandatory)][System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [Parameter(Mandatory)][string]$Label
    )

    $identityCalls = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Invoke-ToolIdentityChecks'
            },
            $true
        )
    )
    $productionIdentityCalls = @(
        $identityCalls |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq '<script>' }
    )
    $selfTestIdentityCalls = @(
        $identityCalls |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq 'Invoke-RunnerSelfTest' }
    )
    Assert-Condition (
        $identityCalls.Count -eq 2 -and
        $productionIdentityCalls.Count -eq 1 -and
        $selfTestIdentityCalls.Count -eq 1
    ) "$Label must contain one production and one separate self-test identity call; total=$($identityCalls.Count); production=$($productionIdentityCalls.Count); selftest=$($selfTestIdentityCalls.Count)"
    $identityTools = Get-CommandParameterValueAst `
        -Command $productionIdentityCalls[0] `
        -Name 'Tools' `
        -Label "$Label production identity call"
    Assert-Condition (
        $identityTools -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $identityTools.VariablePath.UserPath -ceq 'tools'
    ) "$Label production identity call must bind -Tools directly to `$tools"

    $matrixCalls = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Invoke-ProductionMatrixBeforeCleanup'
            },
            $true
        )
    )
    $productionMatrixCalls = @(
        $matrixCalls |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq '<script>' }
    )
    Assert-Condition (
        $matrixCalls.Count -eq 1 -and
        $productionMatrixCalls.Count -eq 1
    ) "$Label must contain exactly one top-level production matrix call; total=$($matrixCalls.Count); production=$($productionMatrixCalls.Count)"
    $matrixTools = Get-CommandParameterValueAst `
        -Command $productionMatrixCalls[0] `
        -Name 'Tools' `
        -Label "$Label production matrix call"
    Assert-Condition (
        $matrixTools -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $matrixTools.VariablePath.UserPath -ceq 'tools'
    ) "$Label production matrix call must bind -Tools directly to `$tools"

    $topLevelCheckedCalls = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Invoke-NativeChecked'
            },
            $true
        ) |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq '<script>' }
    )
    Assert-Condition (
        $topLevelCheckedCalls.Count -eq 2
    ) "$Label must contain exactly the runner.tests and final-status top-level checked calls; found=$($topLevelCheckedCalls.Count)"
    $labeledTopLevelCheckedCalls = foreach ($command in $topLevelCheckedCalls) {
        $labelAst = Get-CommandParameterValueAst `
            -Command $command `
            -Name 'Label' `
            -Label "$Label top-level checked call"
        Assert-Condition (
            $labelAst -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
            $labelAst.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::SingleQuoted
        ) "$Label top-level checked call label must be one single-quoted literal"
        [pscustomobject]@{
            Label = [string]$labelAst.Value
            Command = $command
        }
    }
    $runnerTestCalls = @(
        $labeledTopLevelCheckedCalls |
            Where-Object { $_.Label -ceq 'runner.tests' }
    )
    $finalStatusCalls = @(
        $labeledTopLevelCheckedCalls |
            Where-Object { $_.Label -ceq 'repository.status.ignored-aware' }
    )
    Assert-Condition (
        $runnerTestCalls.Count -eq 1 -and
        $finalStatusCalls.Count -eq 1
    ) "$Label must contain exactly one top-level runner.tests and final-status checked call"
    Assert-Condition (
        (Get-ContainingAssignmentVariableName `
            -Command $runnerTestCalls[0].Command `
            -Label "$Label runner.tests checked call") -ceq 'runnerTests'
    ) "$Label runner.tests checked result must bind directly to `$runnerTests"
    Assert-Condition (
        (Get-ContainingAssignmentVariableName `
            -Command $finalStatusCalls[0].Command `
            -Label "$Label final-status checked call") -ceq 'statusResult'
    ) "$Label final-status checked result must bind directly to `$statusResult"

    $topLevelRunnerParsers = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Assert-RunnerTestsOutput'
            },
            $true
        ) |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq '<script>' }
    )
    Assert-Condition (
        $topLevelRunnerParsers.Count -eq 1
    ) "$Label must contain exactly one top-level runner.tests semantic parser; found=$($topLevelRunnerParsers.Count)"
    $runnerParserResult = Get-CommandParameterValueAst `
        -Command $topLevelRunnerParsers[0] `
        -Name 'Result' `
        -Label "$Label runner.tests semantic parser"
    Assert-Condition (
        $runnerParserResult -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $runnerParserResult.VariablePath.UserPath -ceq 'runnerTests'
    ) "$Label runner.tests semantic parser must consume `$runnerTests"

    $topLevelStatusParsers = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Assert-ZeroRawOutput'
            },
            $true
        ) |
            Where-Object { (Get-EnclosingFunctionName -Node $_) -ceq '<script>' }
    )
    Assert-Condition (
        $topLevelStatusParsers.Count -eq 1
    ) "$Label must contain exactly one top-level final-status parser; found=$($topLevelStatusParsers.Count)"
    $statusParserResult = Get-CommandParameterValueAst `
        -Command $topLevelStatusParsers[0] `
        -Name 'Result' `
        -Label "$Label final-status parser"
    Assert-Condition (
        $statusParserResult -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $statusParserResult.VariablePath.UserPath -ceq 'statusResult'
    ) "$Label final-status parser must consume `$statusResult"

    $writeCommands = @(
        $Ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Write-Output' -and
                $node.CommandElements.Count -eq 2
            },
            $true
        )
    )
    $ignoredStatusMarkers = @(
        $writeCommands |
            Where-Object {
                $_.CommandElements[1].Value -ceq 'IGNORED_AWARE_REPOSITORY_STATUS=EMPTY'
            }
    )
    $matrixPassTemplate = 'PHASE0_MATRIX_PASS|commands=$($script:ToolCommandLabels.Count + $script:MatrixCommandLabels.Count)|tool_labels=$($script:ToolCommandLabels.Count)|matrix_labels=$($script:MatrixCommandLabels.Count)|production_completion=0|release=NO-GO'
    $matrixPassMarkers = @(
        $writeCommands |
            Where-Object { $_.CommandElements[1].Value -ceq $matrixPassTemplate }
    )
    Assert-Condition (
        $ignoredStatusMarkers.Count -eq 1 -and
        (Get-EnclosingFunctionName -Node $ignoredStatusMarkers[0]) -ceq '<script>'
    ) "$Label must contain exactly one top-level exact ignored-aware EMPTY marker"
    Assert-Condition (
        $matrixPassMarkers.Count -eq 1 -and
        (Get-EnclosingFunctionName -Node $matrixPassMarkers[0]) -ceq '<script>'
    ) "$Label must contain exactly one top-level exact PHASE0_MATRIX_PASS marker"

    return [pscustomobject]@{
        IdentityCall = $productionIdentityCalls[0]
        RunnerTestCall = $runnerTestCalls[0].Command
        RunnerParser = $topLevelRunnerParsers[0]
        MatrixCall = $productionMatrixCalls[0]
        FinalStatusCall = $finalStatusCalls[0].Command
        FinalStatusParser = $topLevelStatusParsers[0]
        IgnoredStatusMarker = $ignoredStatusMarkers[0]
        MatrixPassMarker = $matrixPassMarkers[0]
    }
}

function Remove-SourceExtent {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$Extent,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        $Extent.StartOffset -ge 0 -and
        $Extent.EndOffset -gt $Extent.StartOffset -and
        $Extent.EndOffset -le $Source.Length
    ) "$Label has an invalid source extent"
    return (
        $Source.Substring(0, $Extent.StartOffset) +
        $Source.Substring($Extent.EndOffset)
    )
}

function Duplicate-SourceExtent {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$Extent,
        [Parameter(Mandatory)][string]$Label
    )

    $withoutChange = Remove-SourceExtent -Source $Source -Extent $Extent -Label $Label
    Assert-Condition (
        $withoutChange.Length -lt $Source.Length
    ) "$Label could not validate its source extent"
    return (
        $Source.Substring(0, $Extent.EndOffset) +
        [System.Environment]::NewLine +
        $Extent.Text +
        $Source.Substring($Extent.EndOffset)
    )
}

function Move-SourceExtentBefore {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$MovingExtent,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$TargetExtent,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        $MovingExtent.StartOffset -gt $TargetExtent.StartOffset -and
        $MovingExtent.StartOffset -ge $TargetExtent.EndOffset
    ) "$Label requires a later non-overlapping extent to move before its target"
    $withoutMoving = Remove-SourceExtent -Source $Source -Extent $MovingExtent -Label $Label
    return (
        $withoutMoving.Substring(0, $TargetExtent.StartOffset) +
        $MovingExtent.Text +
        [System.Environment]::NewLine +
        $withoutMoving.Substring($TargetExtent.StartOffset)
    )
}

function Move-SourceExtentAfter {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$MovingExtent,
        [Parameter(Mandatory)][System.Management.Automation.Language.IScriptExtent]$TargetExtent,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        $MovingExtent.EndOffset -le $TargetExtent.StartOffset
    ) "$Label requires an earlier non-overlapping extent to move after its target"
    $movingLength = $MovingExtent.EndOffset - $MovingExtent.StartOffset
    $withoutMoving = Remove-SourceExtent -Source $Source -Extent $MovingExtent -Label $Label
    $adjustedTargetEnd = $TargetExtent.EndOffset - $movingLength
    return (
        $withoutMoving.Substring(0, $adjustedTargetEnd) +
        [System.Environment]::NewLine +
        $MovingExtent.Text +
        $withoutMoving.Substring($adjustedTargetEnd)
    )
}

function Assert-RunnerStaticContract {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Label
    )

    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput(
        $Source,
        [ref]$tokens,
        [ref]$parseErrors
    )
    Assert-Condition ($parseErrors.Count -eq 0) "$Label has PowerShell parse errors: $($parseErrors.Message -join '; ')"

    $callOperators = @(
        $ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand
            },
            $true
        )
    )
    Assert-Condition ($callOperators.Count -eq 1) "$Label must contain exactly one call-operator site; found $($callOperators.Count)"
    Assert-Condition (
        $callOperators[0].Extent.Text -match '^&\s+\$executablePath\.FullPath\s+@Arguments\s+2>&1$'
    ) "$Label call-operator site is not the checked wrapper launch: $($callOperators[0].Extent.Text)"

    $dotSources = @(
        $ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Dot
            },
            $true
        )
    )
    Assert-Condition ($dotSources.Count -eq 0) "$Label contains forbidden dot-sourcing"

    $commands = @(
        $ast.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
            $true
        )
    )
    $forbiddenCommands = @(
        'Start-Process',
        'Invoke-Expression',
        'Invoke-Command',
        'cmd',
        'cmd.exe',
        'powershell',
        'powershell.exe',
        'wsl',
        'wsl.exe',
        'pwsh',
        'pwsh.exe',
        'node',
        'node.exe',
        'npm',
        'npm.cmd',
        'go',
        'go.exe',
        'actionlint',
        'actionlint.exe',
        'golangci-lint',
        'golangci-lint.exe',
        'gosec',
        'gosec.exe',
        'govulncheck',
        'govulncheck.exe',
        'docker',
        'docker.exe',
        'git',
        'git.exe'
    )
    foreach ($command in $commands) {
        $commandName = $command.GetCommandName()
        if ($null -ne $commandName) {
            Assert-Condition (
                $forbiddenCommands -notcontains $commandName
            ) "$Label contains forbidden alternate launch command: $commandName"
        }
    }
    foreach ($forbiddenText in @(
        'System.Diagnostics.Process',
        'ProcessStartInfo',
        'Invoke-Expression',
        'Start-Process',
        'WindowsPowerShell',
        '-EncodedCommand',
        'wsl.exe',
        'cmd.exe'
    )) {
        Assert-Condition (
            -not $Source.Contains($forbiddenText)
        ) "$Label contains forbidden alternate launch text: $forbiddenText"
    }

    $adjacentCapturePattern = '(?ms)\$nativeOutput\s*=\s*@\(&\s+\$executablePath\.FullPath\s+@Arguments\s+2>&1\)\s*\r?\n\s*\$nativeExitCode\s*=\s*\$LASTEXITCODE'
    Assert-Condition (
        [regex]::Matches($Source, $adjacentCapturePattern).Count -eq 1
    ) "$Label does not capture LASTEXITCODE immediately after the sole native launch"
    Assert-Condition (
        $Source.Contains("`$ErrorActionPreference = 'Continue'")
    ) "$Label does not bound PSNativeCommandUseErrorActionPreference with EAP Continue"
    Assert-Condition (
        $Source.Contains('throw [NativeCommandFailureException]::new(') -and
        $Source.Contains('@($nativeOutput | ForEach-Object { [string]$_ })')
    ) "$Label does not throw the typed label/exit/output failure"

    $nativeFunction = Get-FunctionAst -Ast $ast -Name 'Invoke-NativeChecked' -Label $Label
    $nativeFunctionText = [string]$nativeFunction.Extent.Text
    $nativeFailureConstructors = @(
        $nativeFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
                $node.Static -and
                [string]$node.Expression.Extent.Text -ceq '[NativeCommandFailureException]' -and
                [string]$node.Member.Value -ceq 'new'
            },
            $true
        )
    )
    Assert-Condition (
        $nativeFailureConstructors.Count -eq 1 -and
        $nativeFailureConstructors[0].Arguments.Count -eq 4 -and
        [string]$nativeFailureConstructors[0].Arguments[3].Extent.Text -ceq
            '@($nativeOutput | ForEach-Object { [string]$_ })'
    ) "$Label must bind exactly one captured NativeOutput payload to the typed native-failure constructor"
    $encodingSetFunction = Get-FunctionAst -Ast $ast -Name 'Set-StrictUtf8NativeOutputEncoding' -Label $Label
    $encodingSetFunctionText = [string]$encodingSetFunction.Extent.Text
    $encodingFingerprintFunction = Get-FunctionAst -Ast $ast -Name 'Get-EncodingFingerprint' -Label $Label
    $encodingFingerprintFunctionText = [string]$encodingFingerprintFunction.Extent.Text
    $encodingSetText = '$null = Set-StrictUtf8NativeOutputEncoding -PriorState $priorEncodingState'
    $nativeLaunchText = '$nativeOutput = @(& $executablePath.FullPath @Arguments 2>&1)'
    $encodingRestoreText = 'Restore-NativeEncodingBoundary -State $priorEncodingState'
    Assert-Condition (
        [regex]::Matches(
            $nativeFunctionText,
            [regex]::Escape($encodingSetText),
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        ).Count -eq 1
    ) "$Label must set the strict UTF-8 native output boundary exactly once"
    Assert-Condition (
        [regex]::Matches(
            $nativeFunctionText,
            [regex]::Escape($encodingRestoreText),
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        ).Count -eq 1
    ) "$Label must restore the native output encoding boundary exactly once"
    $encodingSetIndex = $nativeFunctionText.IndexOf($encodingSetText, [System.StringComparison]::Ordinal)
    $nativeLaunchIndex = $nativeFunctionText.IndexOf($nativeLaunchText, [System.StringComparison]::Ordinal)
    $encodingRestoreIndex = $nativeFunctionText.IndexOf($encodingRestoreText, [System.StringComparison]::Ordinal)
    Assert-Condition (
        $encodingSetIndex -ge 0 -and
        $nativeLaunchIndex -gt $encodingSetIndex -and
        $encodingRestoreIndex -gt $nativeLaunchIndex
    ) "$Label must set strict UTF-8 before the native launch and restore it afterward"
    foreach ($encodingSetContract in @(
        '[System.Text.UTF8Encoding]::new($false, $false)',
        '[System.Text.EncoderReplacementFallback]',
        '[System.Text.DecoderReplacementFallback]',
        '$effective.ConsoleOutputEncoding.Equals($strictUtf8)',
        '$strictUtf8.Equals($effective.ConsoleOutputEncoding)',
        '[System.Console]::OutputEncoding.CodePage -eq 65001',
        "[System.Console]::OutputEncoding.WebName -ceq 'utf-8'",
        '[System.Console]::OutputEncoding.GetPreamble().Length -eq 0'
    )) {
        Assert-Condition (
            $encodingSetFunctionText.Contains($encodingSetContract)
        ) "$Label is missing replacement-fallback UTF-8 setup contract: $encodingSetContract"
    }
    Assert-Condition (
        -not $encodingSetFunctionText.Contains('[System.Text.EncoderExceptionFallback]') -and
        -not $encodingSetFunctionText.Contains('[System.Text.DecoderExceptionFallback]')
    ) "$Label reintroduced exception fallbacks into the native UTF-8 boundary"
    foreach ($fingerprintContract in @(
        'encoder_replacement_utf8=$encoderReplacement',
        'decoder_replacement_utf8=$decoderReplacement',
        '$Encoding.EncoderFallback.DefaultString',
        '$Encoding.DecoderFallback.DefaultString',
        'body_name=$($Encoding.BodyName)',
        'header_name=$($Encoding.HeaderName)',
        'encode_u2714=$(Get-EncodingBytesProbe -Encoding $Encoding -Text ([string][char]0x2714))',
        'encode_unpaired_d800=$(Get-EncodingBytesProbe -Encoding $Encoding -Text ([string][char]0xD800))',
        'decode_e29c94=$(Get-EncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0xE2, 0x9C, 0x94)))',
        'decode_80=$(Get-EncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0x80)))'
    )) {
        Assert-Condition (
            $encodingFingerprintFunctionText.Contains($fingerprintContract)
        ) "$Label is missing exact encoding-fallback fingerprint data: $fingerprintContract"
    }
    Assert-Condition (
        -not $encodingFingerprintFunctionText.Contains('"type=$($Encoding.GetType().AssemblyQualifiedName)"')
    ) "$Label incorrectly treats the Console getter's sealed-wrapper runtime type as encoding semantics"
    foreach ($encodingContract in @(
        '$restored.ConsoleOutputEncoding.Equals($State.ConsoleOutputEncoding)',
        '$State.ConsoleOutputEncoding.Equals($restored.ConsoleOutputEncoding)',
        '[System.Console]::OutputEncoding = $State.ConsoleOutputEncoding',
        '$restored.ConsoleInputEncoding.Equals($State.ConsoleInputEncoding)',
        '$State.ConsoleInputEncoding.Equals($restored.ConsoleInputEncoding)',
        '$restored.PowerShellOutputEncoding.Equals($State.PowerShellOutputEncoding)',
        '$State.PowerShellOutputEncoding.Equals($restored.PowerShellOutputEncoding)',
        'ConsoleOutputRuntimeType = $consoleOutput.GetType().AssemblyQualifiedName',
        '[string[]]$NativeOutput',
        '$this.NativeOutput = @($nativeOutput)',
        '$successEvidence = Get-LeadingUnicodeScalarEvidence -Text $success.Output[0]',
        '-Text $nativeFailureRecord.Exception.NativeOutput[0]',
        '$successEvidence.CodePoint -eq 0x2714',
        '$successEvidence.Utf8Hex -ceq ''E29C94''',
        'codepoint=$($successEvidence.CodePointHex)|utf8=$($successEvidence.Utf8Hex)',
        'codepoint=$($nativeFailureEvidence.CodePointHex)|utf8=$($nativeFailureEvidence.Utf8Hex)',
        'Native output decoding boundary changed Console.InputEncoding',
        'Native output decoding boundary changed the PowerShell OutputEncoding preference',
        'Native output decoding boundary did not restore exact Console.OutputEncoding',
        'NATIVE_COMMAND_ENCODING_RESTORE_FAILED|label=$Label',
        '$lineText.IndexOf([char]0xFFFD)',
        '$lineText.IndexOf([char]0xFEFF)',
        'NATIVE_OUTPUT_REJECTED|label=$Label|line=$lineIndex|codepoint=$rejectedCodePoint',
        'NATIVE_COMMAND_UTF8_DECODE_REJECTED|label=$Label|$decodeBoundaryError',
        'NATIVE_ENCODING_HOST_RESTORE_PASS|',
        'equals_bidirectional=1|semantic_fingerprint=exact|behavior=exact'
    )) {
        Assert-Condition (
            $Source.Contains($encodingContract)
        ) "$Label is missing native encoding contract: $encodingContract"
    }
    $replacementScanIndex = $nativeFunctionText.IndexOf('$lineText.IndexOf([char]0xFFFD)', [System.StringComparison]::Ordinal)
    $bomScanIndex = $nativeFunctionText.IndexOf('$lineText.IndexOf([char]0xFEFF)', [System.StringComparison]::Ordinal)
    $rawLogIndex = $nativeFunctionText.IndexOf('Write-Host "NATIVE_OUTPUT|label=$Label|$lineText"', [System.StringComparison]::Ordinal)
    $successReturnIndex = $nativeFunctionText.IndexOf('return [pscustomobject]@{', [System.StringComparison]::Ordinal)
    Assert-Condition (
        $replacementScanIndex -gt $nativeLaunchIndex -and
        $bomScanIndex -gt $nativeLaunchIndex -and
        $rawLogIndex -gt $replacementScanIndex -and
        $rawLogIndex -gt $bomScanIndex -and
        $successReturnIndex -gt $rawLogIndex
    ) "$Label must reject U+FFFD/U+FEFF before raw logging or semantic success"
    $nativeAssignments = @(
        $nativeFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                [string]$node.Left.Extent.Text -ceq '$nativeOutput' -and
                [string]$node.Right.Extent.Text -ceq '@(& $executablePath.FullPath @Arguments 2>&1)'
            },
            $true
        )
    )
    Assert-Condition (
        $nativeAssignments.Count -eq 1
    ) "$Label must contain one AST-bound native output assignment"
    $nativeLaunchAssignment = $nativeAssignments[0]
    $innerLaunchTry = $nativeLaunchAssignment.Parent
    while ($null -ne $innerLaunchTry -and $innerLaunchTry -isnot [System.Management.Automation.Language.TryStatementAst]) {
        $innerLaunchTry = $innerLaunchTry.Parent
    }
    Assert-Condition (
        $null -ne $innerLaunchTry -and
        $null -ne $innerLaunchTry.Finally
    ) "$Label must wrap the native launch in an inner try/finally"
    $eapRestores = @(
        $innerLaunchTry.Finally.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                [string]$node.Left.Extent.Text -ceq '$ErrorActionPreference' -and
                [string]$node.Right.Extent.Text -ceq '$priorErrorActionPreference'
            },
            $true
        )
    )
    Assert-Condition (
        $eapRestores.Count -eq 1
    ) "$Label must restore ErrorActionPreference in the native launch inner finally"
    $eapImmediatePattern = '(?ms)\$nativeOutput\s*=\s*@\(&\s+\$executablePath\.FullPath\s+@Arguments\s+2>&1\)\s*\r?\n\s*\$nativeExitCode\s*=\s*\$LASTEXITCODE\s*\r?\n\s*}\s*\r?\n\s*finally\s*\{\s*\r?\n\s*\$ErrorActionPreference\s*=\s*\$priorErrorActionPreference'
    Assert-Condition (
        [regex]::Matches($nativeFunctionText, $eapImmediatePattern).Count -eq 1
    ) "$Label must restore ErrorActionPreference immediately after the adjacent LASTEXITCODE capture"
    $restoreCommands = @(
        $nativeFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Restore-NativeEncodingBoundary'
            },
            $true
        )
    )
    Assert-Condition (
        $restoreCommands.Count -eq 1
    ) "$Label must contain one native encoding restoration command in Invoke-NativeChecked"
    $restoreInsideFinally = $false
    $restoreCursor = $restoreCommands[0].Parent
    while ($null -ne $restoreCursor) {
        if (
            $restoreCursor -is [System.Management.Automation.Language.TryStatementAst] -and
            $null -ne $restoreCursor.Finally -and
            $restoreCommands[0].Extent.StartOffset -ge $restoreCursor.Finally.Extent.StartOffset -and
            $restoreCommands[0].Extent.EndOffset -le $restoreCursor.Finally.Extent.EndOffset
        ) {
            $restoreInsideFinally = $true
            break
        }
        $restoreCursor = $restoreCursor.Parent
    }
    Assert-Condition (
        $restoreInsideFinally
    ) "$Label must place native encoding restoration inside the launch try/finally"
    $outerLaunchTry = $null
    $outerLaunchCursor = $restoreCommands[0].Parent
    while ($null -ne $outerLaunchCursor) {
        if (
            $outerLaunchCursor -is [System.Management.Automation.Language.TryStatementAst] -and
            $null -ne $outerLaunchCursor.Finally -and
            $restoreCommands[0].Extent.StartOffset -ge $outerLaunchCursor.Finally.Extent.StartOffset -and
            $restoreCommands[0].Extent.EndOffset -le $outerLaunchCursor.Finally.Extent.EndOffset -and
            $nativeLaunchAssignment.Extent.StartOffset -ge $outerLaunchCursor.Body.Extent.StartOffset -and
            $nativeLaunchAssignment.Extent.EndOffset -le $outerLaunchCursor.Body.Extent.EndOffset
        ) {
            $outerLaunchTry = $outerLaunchCursor
            break
        }
        $outerLaunchCursor = $outerLaunchCursor.Parent
    }
    Assert-Condition (
        $null -ne $outerLaunchTry
    ) "$Label must bind native launch and encoding restoration to one outer try/finally"
    $outerLocationRestores = @(
        $outerLaunchTry.Finally.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Set-Location' -and
                [string]$node.Extent.Text -ceq 'Set-Location -LiteralPath $originalLocation'
            },
            $true
        )
    )
    Assert-Condition (
        $outerLocationRestores.Count -eq 1
    ) "$Label must restore the original location inside the native launch outer finally"

    $webLintFunction = Get-FunctionAst -Ast $ast -Name 'Assert-WebLintSummary' -Label $Label
    $webLintExpectedFunction = Get-FunctionAst -Ast $ast -Name 'Get-ExpectedWebLintOutputLines' -Label $Label
    $webLintFunctionText = [string]$webLintFunction.Extent.Text
    $webLintExpectedText = [string]$webLintExpectedFunction.Extent.Text
    foreach ($lintContract in @(
        "'^[ \t]*✔ No ESLint warnings or errors[ \t]*$'",
        "'Γ£ö No ESLint warnings or errors'",
        'Get-RawOutputLines -Result $Result',
        "'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]'",
        '$lines.Count -eq $expected.Count',
        '$lines[$index] -ceq $expected[$index]'
    )) {
        Assert-Condition (
            $webLintFunctionText.Contains($lintContract)
        ) "$Label is missing strict web-lint parser contract: $lintContract"
    }
    foreach ($lintTranscriptLine in @(
        "'> @blockxone/web@1.0.0 prelint'",
        "'> npm run preflight'",
        "'> @blockxone/web@1.0.0 preflight'",
        "'> node scripts/preflight.mjs'",
        "'Web toolchain preflight passed with Node 22.23.1 and npm 10.9.8.'",
        "'> @blockxone/web@1.0.0 lint'",
        "'> next lint'",
        "'``next lint`` is deprecated and will be removed in Next.js 16.'",
        "'For new projects, use create-next-app to choose your preferred linter.'",
        "'For existing projects, migrate to the ESLint CLI:'",
        "'npx @next/codemod@canary next-lint-to-eslint-cli .'",
        "'✔ No ESLint warnings or errors'"
    )) {
        Assert-Condition (
            $webLintExpectedText.Contains($lintTranscriptLine)
        ) "$Label is missing exact npm/Next lint transcript line: $lintTranscriptLine"
    }
    $actualWebLintTranscript = @(
        $webLintExpectedFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
                $node.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::SingleQuoted
            },
            $true
        ) |
            Sort-Object { $_.Extent.StartOffset } |
            ForEach-Object { [string]$_.Value }
    )
    Assert-SequenceEqual `
        -Actual $actualWebLintTranscript `
        -Expected $expectedWebLintTranscript `
        -Label "$Label exact 19-line npm/Next lint transcript"

    $nextBuildFunction = Get-FunctionAst -Ast $ast -Name 'Assert-NextBuildSummary' -Label $Label
    $nextBuildFunctionText = [string]$nextBuildFunction.Extent.Text
    foreach ($nextBuildContract in @(
        'Get-AnsiNormalizedOutputLinesForParsing -Result $Result',
        '(?<complete>✓[ \t]+)?Generating static pages',
        '(?<done>0|[1-9][0-9]*)',
        '(?<total>0|[1-9][0-9]*)',
        '(?<pending> \.\.\.)?',
        '$literalMatches.Count -eq 1',
        '$total -eq [uint64]45 -and $done -le $total',
        '$labelLineCount -eq $progressLines.Count -and $progressLines.Count -ge 2',
        '$first.Done -eq [uint64]0',
        '-not $first.HasCompletionMark',
        '$first.HasPendingSuffix',
        '$last.Done -eq [uint64]45',
        '$last.HasCompletionMark',
        '-not $last.HasPendingSuffix',
        '$startCount -eq 1 -and $finalCount -eq 1',
        '$progress.Done -gt $priorDone',
        '$progress.Done -ge [uint64]1',
        '$progress.Done -le [uint64]44',
        '-not $progress.HasCompletionMark',
        '-not $progress.HasPendingSuffix'
    )) {
        Assert-Condition (
            $nextBuildFunctionText.Contains($nextBuildContract)
        ) "$Label is missing strict Next.js build-summary contract: $nextBuildContract"
    }

    Assert-SequenceEqual -Actual (Get-PlanOwnedArray -Source $Source -VariableName 'ToolCommandLabels') -Expected $expectedToolLabels -Label "$Label tool inventory"
    Assert-SequenceEqual -Actual (Get-PlanOwnedArray -Source $Source -VariableName 'MatrixCommandLabels') -Expected $expectedMatrixLabels -Label "$Label matrix inventory"

    $identityFunction = Get-FunctionAst -Ast $ast -Name 'Invoke-ToolIdentityChecks' -Label $Label
    $matrixFunction = Get-FunctionAst -Ast $ast -Name 'Invoke-ProductionMatrixBeforeCleanup' -Label $Label
    $goDiscoveryFunction = Get-FunctionAst -Ast $ast -Name 'Assert-GoDiscovery' -Label $Label
    Assert-Condition (
        $expectedGoTestedPackages.Count -eq 12 -and
        $expectedGoNoTestPackages.Count -eq 13 -and
        @($expectedGoTestedPackages + $expectedGoNoTestPackages | Sort-Object -Unique).Count -eq 25
    ) 'Test-owned Go package inventories must be exact, immutable and disjoint'
    $goDiscoveryText = [string]$goDiscoveryFunction.Extent.Text
    foreach ($package in @($expectedGoTestedPackages + $expectedGoNoTestPackages)) {
        Assert-Condition (
            [regex]::Matches(
                $goDiscoveryText,
                [regex]::Escape("'$package'"),
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            ).Count -eq 1
        ) "$Label must bind Go discovery package '$package' exactly once"
    }
    foreach ($goDiscoveryContract in @(
        '$noTestStarts.SetEquals($expectedNoTestPackages)',
        '$noTestOutputs.SetEquals($expectedNoTestPackages)',
        '$noTestSkips.SetEquals($expectedNoTestPackages)',
        '$packagePasses.SetEquals($expectedTestedPackages)',
        '$elapsedProperty.Value -is [long]',
        '0.250d',
        '$propertyShape -ceq ''Time,Action,Package''',
        '$propertyShape -ceq ''Time,Action,Package,Output''',
        '$propertyShape -ceq ''Time,Action,Package,Elapsed''',
        '$state -eq 0',
        '$state -eq 1',
        '$state -eq 2',
        '$noTestStates[$package] -eq 3',
        '''\A(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\z''',
        '$properties[''Elapsed''].TryGetDouble(',
        '[double]::IsFinite($elapsedSeconds)',
        '$elapsedSeconds -le $maxNoTestElapsedSeconds',
        '$expectedOutput = "?   `t$package`t[no test files]`n"',
        '$properties[''Output''].GetString() -ceq $expectedOutput',
        '$testPassCount -eq 357',
        '$testSkipCount -eq 0'
    )) {
        Assert-Condition (
            $goDiscoveryText.Contains($goDiscoveryContract)
        ) "$Label is missing exact Go discovery package contract: $goDiscoveryContract"
    }
    foreach ($run57FixtureContract in @(
        '$run57NoTestEvents.Count -eq 39',
        'A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88',
        '$run57NoTestHash = Get-Utf8Sha256 -Text ($run57NoTestEvents -join "`n")',
        '348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8',
        '$run57NoTestIndicesHash = Get-Utf8Sha256 -Text ($run57NoTestIndices -join '','')',
        '$run57RepresentativeLines.Count -eq 1598',
        '$globalIndex -eq $run57NoTestIndices[$noTestIndex]',
        '$run57ParserOutput.Count -eq 1',
        '$run57ParserOutput[0] -ceq $expectedRun57ParserOutput'
    )) {
        Assert-Condition (
            $Source.Contains($run57FixtureContract)
        ) "$Label is missing exact run57 representative-interleaving fixture contract: $run57FixtureContract"
    }
    $run57EventAssignments = @(
        $ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Left.VariablePath.UserPath -ceq 'run57NoTestEvents'
            },
            $true
        )
    )
    Assert-Condition (
        $run57EventAssignments.Count -eq 1
    ) "$Label must define the exact run57 no-test event fixture once"
    $run57EventStrings = @(
        $run57EventAssignments[0].Right.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
            },
            $true
        ) |
            Sort-Object { $_.Extent.StartOffset } |
            ForEach-Object { [string]$_.Value }
    )
    Assert-Condition (
        $run57EventStrings.Count -eq 39 -and
        (Get-TextUtf8Sha256 -Text ($run57EventStrings -join "`n")) -ceq
            'A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88'
    ) "$Label exact run57 no-test event fixture hash differs"
    $run57IndexAssignments = @(
        $ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Left.VariablePath.UserPath -ceq 'run57NoTestIndices'
            },
            $true
        )
    )
    Assert-Condition (
        $run57IndexAssignments.Count -eq 1
    ) "$Label must define the exact run57 no-test index fixture once"
    $run57Indices = @(
        $run57IndexAssignments[0].Right.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.ConstantExpressionAst] -and
                $node.Value -is [int]
            },
            $true
        ) |
            Sort-Object { $_.Extent.StartOffset } |
            ForEach-Object { [string]$_.Value }
    )
    Assert-Condition (
        $run57Indices.Count -eq 39 -and
        (Get-TextUtf8Sha256 -Text ($run57Indices -join ',')) -ceq
            '348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8'
    ) "$Label exact run57 no-test event-index fixture hash differs"

    $sharpLiteralAssignments = @(
        $ast.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Left.VariablePath.UserPath -ceq 'script:RequiredSharpSmokeScript'
            },
            $true
        )
    )
    Assert-Condition (
        $sharpLiteralAssignments.Count -eq 1
    ) "$Label must define the exact Sharp smoke literal exactly once; found=$($sharpLiteralAssignments.Count)"
    $sharpLiteralRight = $sharpLiteralAssignments[0].Right
    Assert-Condition (
        $sharpLiteralRight -is [System.Management.Automation.Language.CommandExpressionAst] -and
        $sharpLiteralRight.Expression -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
        $sharpLiteralRight.Expression.StringConstantType -eq [System.Management.Automation.Language.StringConstantType]::SingleQuotedHereString
    ) "$Label Sharp smoke literal must be one non-expandable single-quoted here-string"
    $sharpLiteral = [string]$sharpLiteralRight.Expression.Value
    $sharpLiteralUtf8Bytes = [System.Text.UTF8Encoding]::new($false, $true).GetByteCount($sharpLiteral)
    $sharpLiteralSha256 = Get-TextUtf8Sha256 -Text $sharpLiteral
    Assert-Condition (
        $sharpLiteral -ceq $requiredSharpSmokeScript -and
        $sharpLiteralUtf8Bytes -eq $requiredSharpSmokeUtf8Bytes -and
        $sharpLiteralSha256 -ceq $requiredSharpSmokeSha256
    ) "$Label Sharp smoke literal differs from the exact Plan 00-12 bytes"
    Assert-Condition (
        @($sharpLiteral.ToCharArray() | Where-Object { [int]$_ -eq 96 }).Count -eq 2 -and
        [regex]::Matches($sharpLiteral, '\$\{').Count -eq 6
    ) "$Label Sharp smoke literal lost backticks or literal interpolation tokens"

    $sharpScriptAssignments = @(
        $matrixFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
                $node.Left.VariablePath.UserPath -ceq 'sharpScript'
            },
            $true
        )
    )
    Assert-Condition (
        $sharpScriptAssignments.Count -eq 1
    ) "$Label matrix must bind sharpScript exactly once; found=$($sharpScriptAssignments.Count)"
    $sharpScriptRight = $sharpScriptAssignments[0].Right
    Assert-Condition (
        $sharpScriptRight -is [System.Management.Automation.Language.CommandExpressionAst] -and
        $sharpScriptRight.Expression -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $sharpScriptRight.Expression.VariablePath.UserPath -ceq 'script:RequiredSharpSmokeScript'
    ) "$Label matrix sharpScript must bind directly to the accepted literal"

    $sharpIntegrityCommands = @(
        $matrixFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Assert-SharpSmokeScriptIntegrity'
            },
            $true
        )
    )
    Assert-Condition (
        $sharpIntegrityCommands.Count -eq 1
    ) "$Label matrix must enforce Sharp script integrity exactly once; found=$($sharpIntegrityCommands.Count)"
    $sharpIntegrityScript = Get-CommandParameterValueAst -Command $sharpIntegrityCommands[0] -Name 'Script' -Label "$Label Sharp integrity call"
    Assert-Condition (
        $sharpIntegrityScript -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $sharpIntegrityScript.VariablePath.UserPath -ceq 'sharpScript'
    ) "$Label Sharp integrity call must check the exact local sharpScript"

    $sharpNativeCommands = [System.Collections.Generic.List[System.Management.Automation.Language.CommandAst]]::new()
    foreach ($command in @(
        $matrixFunction.Body.FindAll(
            {
                param($node)
                $node -is [System.Management.Automation.Language.CommandAst] -and
                $node.GetCommandName() -ceq 'Invoke-NativeChecked'
            },
            $true
        )
    )) {
        $commandLabel = Get-CommandParameterValueAst -Command $command -Name 'Label' -Label "$Label native call"
        if (
            $commandLabel -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
            $commandLabel.Value -ceq 'web.sharp-smoke'
        ) {
            $sharpNativeCommands.Add($command)
        }
    }
    Assert-Condition (
        $sharpNativeCommands.Count -eq 1
    ) "$Label must bind web.sharp-smoke to exactly one native call; found=$($sharpNativeCommands.Count)"
    $sharpNativeCommand = $sharpNativeCommands[0]
    $sharpExecutable = Get-CommandParameterValueAst -Command $sharpNativeCommand -Name 'Executable' -Label "$Label web.sharp-smoke"
    $sharpArguments = Get-CommandParameterValueAst -Command $sharpNativeCommand -Name 'Arguments' -Label "$Label web.sharp-smoke"
    $sharpWorkingDirectory = Get-CommandParameterValueAst -Command $sharpNativeCommand -Name 'WorkingDirectory' -Label "$Label web.sharp-smoke"
    Assert-Condition (
        $sharpExecutable -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $sharpExecutable.VariablePath.UserPath -ceq 'script:NodePath'
    ) "$Label web.sharp-smoke must execute pinned Node"
    Assert-Condition (
        (($sharpArguments.Extent.Text -replace '\s', '') -ceq '@(''-e'',$sharpScript)')
    ) "$Label web.sharp-smoke argv must be exactly @('-e',`$sharpScript)"
    Assert-Condition (
        $sharpWorkingDirectory -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $sharpWorkingDirectory.VariablePath.UserPath -ceq 'script:RepositoryRoot'
    ) "$Label web.sharp-smoke must execute at the repository root"
    Assert-Condition (
        $sharpScriptAssignments[0].Extent.StartOffset -lt $sharpIntegrityCommands[0].Extent.StartOffset -and
        $sharpIntegrityCommands[0].Extent.StartOffset -lt $sharpNativeCommand.Extent.StartOffset
    ) "$Label must bind, hash-check, then execute the Sharp script in that order"

    Assert-SequenceEqual -Actual (Get-LiteralCheckedLabels -Scope $identityFunction.Body) -Expected $expectedToolLabels[0..9] -Label "$Label identity call sites"
    Assert-SequenceEqual -Actual (Get-LiteralCheckedLabels -Scope $matrixFunction.Body) -Expected $expectedMatrixLabels[0..37] -Label "$Label matrix call sites"

    $allLiteralLabels = @(Get-LiteralCheckedLabels -Scope $ast)
    foreach ($productionLabel in @($expectedToolLabels + $expectedMatrixLabels)) {
        Assert-Condition (
            @($allLiteralLabels | Where-Object { $_ -ceq $productionLabel }).Count -eq 1
        ) "$Label must map production label '$productionLabel' to exactly one checked call site"
    }
    $unexpectedProductionLabels = @(
        $allLiteralLabels |
            Where-Object {
                $_ -notlike 'selftest.*' -and
                $_ -notin @($expectedToolLabels + $expectedMatrixLabels)
            }
    )
    Assert-Condition (
        $unexpectedProductionLabels.Count -eq 0
    ) "$Label contains unexpected checked production labels: $($unexpectedProductionLabels -join ', ')"

    Assert-Condition (
        -not $Source.Contains('Assert-OutputPattern')
    ) "$Label contains the retired generic Assert-OutputPattern gate"
    foreach ($parserName in $semanticParserNames) {
        $null = Get-FunctionAst -Ast $ast -Name $parserName -Label $Label
    }
    Assert-Condition (
        @($expectedSemanticParserBindings | ForEach-Object Label | Sort-Object -Unique).Count -eq
            $expectedSemanticParserBindings.Count
    ) 'Test-owned semantic parser binding inventory contains duplicate labels'
    Assert-Condition (
        $expectedSemanticParserBindings.Count -eq
            ($expectedToolLabels.Count + $expectedMatrixLabels.Count - 1)
    ) 'Semantic parser inventory must cover every checked production label except go.test'

    $actualParserBindings = @(
        Get-CheckedParserBindings -Ast $ast -ParserNames $semanticParserNames -Label $Label
    )
    foreach ($expectedBinding in $expectedSemanticParserBindings) {
        $matches = @(
            $actualParserBindings |
                Where-Object { $_.Label -ceq $expectedBinding.Label }
        )
        Assert-Condition (
            $matches.Count -eq 1
        ) "$Label must bind '$($expectedBinding.Label)' to exactly one semantic parser; found=$($matches.Count)"
        Assert-Condition (
            $matches[0].Parser -ceq $expectedBinding.Parser
        ) "$Label maps '$($expectedBinding.Label)' to '$($matches[0].Parser)' instead of '$($expectedBinding.Parser)'"
        Assert-Condition (
            $matches[0].ParserCommand.Extent.StartOffset -gt
                $matches[0].InvocationCommand.Extent.EndOffset
        ) "$Label parses '$($expectedBinding.Label)' before its checked invocation completed"
        if ($null -ne $matches[0].NextInvocationCommand) {
            Assert-Condition (
                $matches[0].ParserCommand.Extent.EndOffset -lt
                    $matches[0].NextInvocationCommand.Extent.StartOffset
            ) "$Label delays '$($expectedBinding.Label)' parsing until after the next checked invocation"
        }
    }
    Assert-Condition (
        @($actualParserBindings | Where-Object { $_.Label -ceq 'go.test' }).Count -eq 0
    ) "$Label must leave go.test native-authority-only; go.test.discovery owns discovery semantics"
    $unexpectedParserBindings = @(
        $actualParserBindings |
            Where-Object {
                $_.Label -in @($expectedToolLabels + $expectedMatrixLabels) -and
                $_.Label -notin @($expectedSemanticParserBindings | ForEach-Object Label)
            }
    )
    Assert-Condition (
        $unexpectedParserBindings.Count -eq 0
    ) "$Label contains unexpected production parser bindings: $(
        @($unexpectedParserBindings | ForEach-Object { "$($_.Label)->$($_.Parser)" }) -join ', '
    )"
    foreach ($requiredParserPrimitive in @(
        '[System.Globalization.NumberStyles]::None',
        '[System.Globalization.CultureInfo]::InvariantCulture',
        '[uint64]::TryParse(',
        'Get-AnsiNormalizedOutputLinesForParsing',
        "'[\x1B\x80-\x9F]'",
        '[timespan]::FromSeconds(1)'
    )) {
        Assert-Condition (
            $Source.Contains($requiredParserPrimitive)
        ) "$Label is missing strict semantic-parser primitive: $requiredParserPrimitive"
    }
    $orchestration = Get-ProductionOrchestrationAsts -Ast $ast -Label $Label
    Assert-Condition (
        $orchestration.IdentityCall.Extent.EndOffset -lt
            $orchestration.RunnerTestCall.Extent.StartOffset -and
        $orchestration.RunnerTestCall.Extent.EndOffset -lt
            $orchestration.RunnerParser.Extent.StartOffset -and
        $orchestration.RunnerParser.Extent.EndOffset -lt
            $orchestration.MatrixCall.Extent.StartOffset -and
        $orchestration.MatrixCall.Extent.EndOffset -lt
            $orchestration.FinalStatusCall.Extent.StartOffset -and
        $orchestration.FinalStatusCall.Extent.EndOffset -lt
            $orchestration.FinalStatusParser.Extent.StartOffset -and
        $orchestration.FinalStatusParser.Extent.EndOffset -lt
            $orchestration.IgnoredStatusMarker.Extent.StartOffset -and
        $orchestration.IgnoredStatusMarker.Extent.EndOffset -lt
            $orchestration.MatrixPassMarker.Extent.StartOffset
    ) "$Label does not preserve identity -> runner.tests -> runner parser -> matrix -> final status -> final parser -> EMPTY -> MATRIX_PASS ordering"

    Assert-Condition (
        $Source.Contains('return Invoke-NativeChecked -Label $Label -Executable $script:NodePath -Arguments @(') -and
        $Source.Contains('$script:NpmCliPath') -and
        $Source.Contains('return Invoke-NativeChecked -Label $Label -Executable $script:GoPath')
    ) "$Label does not bind npm to pinned Node/npm CLI and Go to pinned Go"
    Assert-Condition (
        -not $Source.Contains("Resolve-ExternalApplication -Name 'node'") -and
        -not $Source.Contains("Resolve-ExternalApplication -Name 'npm'") -and
        -not $Source.Contains("Resolve-ExternalApplication -Name 'go'")
    ) "$Label contains forbidden PATH fallback for Node/npm/Go"
    foreach ($requiredBinding in @(
        "`$script:RequiredNodePath = '$nodeExecutable'",
        "`$script:RequiredNpmCliPath = '$npmCli'",
        "`$script:RequiredGoPath = '$goExecutable'",
        "`$script:RequiredNpmShimSha256 = '225730FB64FF01F37EB6D2CCA0003C314DE19BC6D72A06E2AB9649B24362603E'",
        "`$script:NpmShimPath = Assert-LeafHash",
        "`$goDirectory = Split-Path -Parent `$script:GoPath",
        "`$pathParts.Add(`$goDirectory)",
        "Restore-ProcessEnvironmentState -State `$script:PriorPath",
        "SELFTEST_PATH_RESTORED=EXACT",
        "Self-test outer PATH restoration was not exact",
        "Matrix outer PATH restoration was not exact",
        "Assert-GosecZeroIssues -Result `$gosec",
        "`$normalized = Remove-AnsiSgrForParsing -Text ([string]`$rawLine)",
        "'(?:\x1B\[|\x9B)[0-?]*[ -/]*m'",
        "`$issueLabelLines.Count -eq 1",
        "`$issueMatches.Count -eq 1",
        "[uint64]::TryParse(",
        "`$issueCount -eq [uint64]0",
        "`$script:RequiredSharpSmokeUtf8Bytes = 720",
        "`$script:RequiredSharpSmokeSha256 = '$requiredSharpSmokeSha256'",
        "`$hash -ceq `$script:RequiredSharpSmokeSha256",
        "`$null = Assert-SharpSmokeScriptIntegrity -Script `$sharpScript"
    )) {
        Assert-Condition $Source.Contains($requiredBinding) "$Label is missing controlled-path binding: $requiredBinding"
    }
    $nodePathIndex = $Source.IndexOf('$pathParts.Add($nodeDirectory)', [System.StringComparison]::Ordinal)
    $npmPathIndex = $Source.IndexOf('$pathParts.Add($npmShimDirectory)', [System.StringComparison]::Ordinal)
    $goPathIndex = $Source.IndexOf('$pathParts.Add($goDirectory)', [System.StringComparison]::Ordinal)
    $priorPathIndex = $Source.IndexOf('$pathParts.Add($script:PriorPath.Value)', [System.StringComparison]::Ordinal)
    Assert-Condition (
        $nodePathIndex -ge 0 -and
        $npmPathIndex -gt $nodePathIndex -and
        $goPathIndex -gt $npmPathIndex -and
        $priorPathIndex -gt $goPathIndex
    ) "$Label does not prepend pinned Node, npm shim and Go directories before prior PATH"
    Assert-Condition (
        $Source.Contains('[System.IO.File]::Move(') -and
        $Source.Contains('[System.IO.Directory]::Move(') -and
        -not $Source.Contains('Move-Item')
    ) "$Label does not use atomic no-overwrite file/directory move primitives"
}

function New-MutatedRunnerFixture {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Label
    )

    $root = New-TestRoot -Label $Label
    $scripts = Join-Path $root '.planning\scripts'
    [System.IO.Directory]::CreateDirectory($scripts) | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $root 'apps\web')) | Out-Null
    [System.IO.Directory]::CreateDirectory((Join-Path $root 'contracts')) | Out-Null
    $path = Join-Path $scripts 'invoke-phase0-matrix.ps1'
    [System.IO.File]::WriteAllText($path, $Source, [System.Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{
        Root = $root
        Path = $path
    }
}

function Assert-InvalidPinnedInput {
    param(
        [Parameter(Mandatory)][string]$InputName,
        [Parameter(Mandatory)][string]$InvalidPath,
        [Parameter(Mandatory)][string]$ExpectedText
    )

    $arguments = @{
        Node = $nodeExecutable
        Npm = $npmCli
        Go = $goExecutable
    }
    $arguments[$InputName] = $InvalidPath
    $result = Invoke-RunnerSelfTestProcess -Case 'native-success' -Node $arguments.Node -Npm $arguments.Npm -Go $arguments.Go
    Assert-ProcessFailure -Result $result -Marker $ExpectedText -Label "invalid $InputName input"
}

function Initialize-GitFixture {
    param([Parameter(Mandatory)][string]$Root)

    foreach ($arguments in @(
        @('-C', $Root, 'init', '--quiet'),
        @('-C', $Root, 'config', 'core.longpaths', 'true'),
        @('-C', $Root, 'config', 'user.name', 'Phase0 Runner Fixture'),
        @('-C', $Root, 'config', 'user.email', 'phase0-runner-fixture@invalid.example')
    )) {
        $result = Invoke-TestProcess -Executable $gitExecutable -Arguments $arguments -WorkingDirectory $Root
        Assert-Condition ($result.ExitCode -eq 0) "Unable to initialize Git fixture: $($result.Text)"
    }
}

function Commit-GitFixture {
    param(
        [Parameter(Mandatory)][string]$Root,
        [string]$Message = 'fixture state'
    )

    foreach ($arguments in @(
        @('-C', $Root, 'add', '--all'),
        @('-C', $Root, 'commit', '--quiet', '--allow-empty', '-m', $Message)
    )) {
        $result = Invoke-TestProcess -Executable $gitExecutable -Arguments $arguments -WorkingDirectory $Root
        Assert-Condition ($result.ExitCode -eq 0) "Unable to commit Git fixture: $($result.Text)"
    }
}

function Copy-PlanningFixture {
    param(
        [Parameter(Mandatory)][string]$Label,
        [switch]$WithoutSummary
    )

    $root = New-TestRoot -Label $Label
    Copy-Item -LiteralPath (Join-Path $repoRoot '.planning') -Destination $root -Recurse -Force
    $web = Join-Path $root 'apps\web'
    [System.IO.Directory]::CreateDirectory($web) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'apps\web\.gitignore') -Destination (Join-Path $web '.gitignore')
    if ($WithoutSummary) {
        $summary = Join-Path $root '.planning\phases\00-planning-truth-and-containment\00-04-SUMMARY.md'
        if (Test-Path -LiteralPath $summary) {
            [System.IO.File]::Move($summary, (Join-Path $root 'held-00-04-SUMMARY.md'))
        }
    }
    Initialize-GitFixture -Root $root
    Commit-GitFixture -Root $root -Message 'clean planning fixture'
    return $root
}

function Invoke-PlanningValidatorFixture {
    param(
        [Parameter(Mandatory)][string]$Root,
        [ValidateSet('BuilderStaged', 'CleanCandidate')]
        [string]$Mode = 'CleanCandidate'
    )

    $nodeDirectory = Split-Path -Parent $nodeExecutable
    $pathValue = "$nodeDirectory$([System.IO.Path]::PathSeparator)$env:PATH"
    return Invoke-TestProcess -Executable $pwshExecutable -WorkingDirectory $Root -Environment @{
        PATH = $pathValue
    } -Arguments @(
        '-NoProfile',
        '-File',
        (Join-Path $Root '.planning\scripts\validate-planning.ps1'),
        '-ResidueMode',
        $Mode
    )
}

function Mutate-TextOnce {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Old,
        [Parameter(Mandatory)][string]$New
    )

    $text = [System.IO.File]::ReadAllText($Path)
    Assert-Condition ($text.Contains($Old)) "Mutation source text was not found in $Path`: $Old"
    [System.IO.File]::WriteAllText($Path, $text.Replace($Old, $New), [System.Text.UTF8Encoding]::new($false))
}

function Invoke-CleanMutationCase {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][scriptblock]$Mutation,
        [Parameter(Mandatory)][string]$ExpectedText,
        [switch]$WithoutSummary
    )

    $root = Copy-PlanningFixture -Label "mutation-$Label" -WithoutSummary:$WithoutSummary
    $null = $Mutation.Invoke($root)
    Commit-GitFixture -Root $root -Message "mutation $Label"
    $result = Invoke-PlanningValidatorFixture -Root $root -Mode CleanCandidate
    Assert-ProcessFailure -Result $result -Marker $ExpectedText -Label "planning mutation $Label"
    Write-Output "PLANNING_MUTATION_PASS|label=$Label|summary_present=$(-not $WithoutSummary)"
}

function Invoke-PlanningMutationSuites {
    $summaryRoot = Copy-PlanningFixture -Label 'summary-positive'
    $summaryPositive = Invoke-PlanningValidatorFixture -Root $summaryRoot
    Assert-ProcessPass -Result $summaryPositive -Marker 'GSD_ARTIFACT_PROGRESS=8%' -Label 'summary-present planning positive'
    Assert-Condition ($summaryPositive.Text.Contains('PLANS=12')) 'Summary planning positive did not report 12 plans'

    $noSummaryRoot = Copy-PlanningFixture -Label 'no-summary-positive' -WithoutSummary
    $noSummaryPositive = Invoke-PlanningValidatorFixture -Root $noSummaryRoot
    Assert-ProcessPass -Result $noSummaryPositive -Marker 'GSD_ARTIFACT_PROGRESS=0%' -Label 'no-summary planning positive'
    Assert-Condition ($noSummaryPositive.Text.Contains('GSD_ARTIFACT_STATE=planned')) 'No-summary planning positive was not planned/0'

    $script:SemanticMutationCount = 0
    $semanticCases = @(
        @{
            Label = 'plan-missing'
            Expected = 'Phase 0 plan filenames mismatch'
            Mutation = {
                param($root)
                [System.IO.File]::Move(
                    (Join-Path $root '.planning\phases\00-planning-truth-and-containment\00-01-PLAN.md'),
                    (Join-Path $root 'held-plan.md')
                )
            }
        },
        @{
            Label = 'plan-extra'
            Expected = 'Phase 0 plan filenames mismatch'
            Mutation = {
                param($root)
                [System.IO.File]::WriteAllText(
                    (Join-Path $root '.planning\phases\00-planning-truth-and-containment\00-13-PLAN.md'),
                    'mutation'
                )
            }
        },
        @{
            Label = 'state-total-plans'
            Expected = "STATE 'total_plans' must be exactly '12'"
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\STATE.md') -Old '  total_plans: 12' -New '  total_plans: 11'
            }
        },
        @{
            Label = 'state-completed-plans'
            Expected = "STATE 'completed_plans' must be exactly '0'"
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\STATE.md') -Old '  completed_plans: 0' -New '  completed_plans: 1'
            }
        },
        @{
            Label = 'roadmap-complete'
            Expected = 'Expected zero completed roadmap phases'
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\ROADMAP.md') -Old '- [ ] **Phase 0: Planning Truth and Containment**' -New '- [x] **Phase 0: Planning Truth and Containment**'
            }
        },
        @{
            Label = 'requirement-checked'
            Expected = 'Expected 89 unchecked requirements'
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\REQUIREMENTS.md') -Old '- [ ] **BASE-01:**' -New '- [x] **BASE-01:**'
            }
        },
        @{
            Label = 'summary-status'
            Expected = "00-04-SUMMARY.md 'status' must be exactly"
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\phases\00-planning-truth-and-containment\00-04-SUMMARY.md') -Old 'status: implementation_frozen_for_independent_review' -New 'status: complete'
            }
        },
        @{
            Label = 'summary-release'
            Expected = "00-04-SUMMARY.md 'release_status' must be exactly"
            Mutation = {
                param($root)
                Mutate-TextOnce -Path (Join-Path $root '.planning\phases\00-planning-truth-and-containment\00-04-SUMMARY.md') -Old 'release_status: NO-GO' -New 'release_status: GO'
            }
        }
    )
    foreach ($case in $semanticCases) {
        Invoke-CleanMutationCase -Label $case.Label -Mutation $case.Mutation -ExpectedText $case.Expected
        $script:SemanticMutationCount++
    }

    $currentTruthStatements = @(
        "I4's aggregate matrix PASS is not accepted because mandatory native exits were maskable.",
        "I4's individual command and mutation outputs remain narrow historical evidence only.",
        'The attempted R4 produced only SECURITY-REVIEW-FAILURE-RECEIPT-v4.md; no R4, V4 or C4 exists.',
        'The six recoverably moved .git/objects files were repository-metadata mutations, not tracked working-tree edits.',
        'The v4 failure receipt SHA-256 is 0D9B3DF8697646FBB4747BD12B3521DA39E898C286593809CF9C3492176DD7B5.',
        'P11 is 85964576707555b0b2ad3df6b297e1cb9a602d0a with Plan 00-12 SHA-256 A702B1F506E23FDF475702A76CB30041F295485DFE1BC922D00B19ADC0B439AC.',
        'The Plan 00-12 task paths /root, /root/gen3_plan12_checker, /root/gen3_i5_builder, /root/gen3_r5_security_reviewer, /root/gen3_v5_verifier and /root/gen3_c5_admission_owner are pairwise distinct workflow provenance, not legal-person or professional independence.',
        'Typed roots: TEST_CONTRACT_NATIVE_EXIT_MASKING, EVIDENCE_PROVENANCE_PATH_TRANSCRIPTION_ERROR, GENERATED_OUTPUT_ANCESTOR_REPARSE_ESCAPE, AGENT_ROLE_PROVENANCE_OMISSION and EVIDENCE_SCOPE_WORDING_OVERSTATEMENT.',
        'Phase 0 remains in_progress, production completion remains zero, and release remains NO-GO.'
    )
    $truthPaths = @(
        '.planning/BLOCKERS.md',
        '.planning/EVIDENCE-REGISTER.md',
        '.planning/STATE.md',
        '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md',
        '.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md'
    )
    $script:TruthMutationCount = 0
    foreach ($truthPath in $truthPaths) {
        foreach ($statement in $currentTruthStatements) {
            $casePath = $truthPath
            $caseStatement = $statement
            $label = 'truth-' + ([System.IO.Path]::GetFileNameWithoutExtension($truthPath) -replace '[^A-Za-z0-9]', '-') + '-' + $script:TruthMutationCount
            Invoke-CleanMutationCase -Label $label -ExpectedText 'Current-truth contract missing' -Mutation {
                param($root)
                $fullPath = Join-Path $root $casePath
                Mutate-TextOnce -Path $fullPath -Old $caseStatement -New "CURRENT-TRUTH-STATEMENT-REMOVED-$($script:TruthMutationCount)"
            }
            $script:TruthMutationCount++
        }
    }

    foreach ($withoutSummary in @($false, $true)) {
        $label = if ($withoutSummary) { 'ignored-no-summary' } else { 'ignored-summary' }
        $root = Copy-PlanningFixture -Label $label -WithoutSummary:$withoutSummary
        $ignoredPath = Join-Path $root 'apps\web\next-env.d.ts'
        [System.IO.File]::WriteAllText($ignoredPath, "// ignored runner fixture`n")
        $ignoredResult = Invoke-PlanningValidatorFixture -Root $root
        Assert-ProcessFailure -Result $ignoredResult -Marker 'Clean-candidate mode requires empty ignored-aware repository status' -Label $label
        [System.IO.File]::Delete($ignoredPath)
        $restoredResult = Invoke-PlanningValidatorFixture -Root $root
        Assert-ProcessPass -Result $restoredResult -Marker 'PLANNING_VALIDATION=PASS' -Label "$label restored"
    }

    Write-Output "PLANNING_MUTATION_SUITES_PASS|semantic=$script:SemanticMutationCount|current_truth=$script:TruthMutationCount|summary_positive=1|no_summary_positive=1|ignored_restore=2"
}

function New-BuilderStagedFixture {
    param([Parameter(Mandatory)][string]$Label)

    $root = New-TestRoot -Label $Label
    Copy-Item -LiteralPath (Join-Path $repoRoot '.planning') -Destination $root -Recurse -Force
    $web = Join-Path $root 'apps\web'
    [System.IO.Directory]::CreateDirectory($web) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'apps\web\.gitignore') -Destination (Join-Path $web '.gitignore')
    $newScripts = @(
        '.planning\scripts\invoke-phase0-matrix.ps1',
        '.planning\scripts\test-phase0-matrix-runner.ps1'
    )
    foreach ($path in $newScripts) {
        [System.IO.File]::Move((Join-Path $root $path), (Join-Path $root ([System.IO.Path]::GetFileName($path) + '.held')))
    }
    $modifiedPaths = @(
        '.planning\TEST-CONTRACT.md',
        '.planning\scripts\validate-planning.ps1',
        '.planning\BLOCKERS.md',
        '.planning\EVIDENCE-REGISTER.md',
        '.planning\STATE.md',
        '.planning\phases\00-planning-truth-and-containment\00-04-SUMMARY.md',
        '.planning\phases\00-planning-truth-and-containment\00-EVIDENCE.md'
    )
    foreach ($path in $modifiedPaths) {
        [System.IO.File]::AppendAllText((Join-Path $root $path), "`nBASELINE-BEFORE-I5`n")
    }
    Initialize-GitFixture -Root $root
    Commit-GitFixture -Root $root -Message 'P11-like fixture baseline'
    foreach ($path in $modifiedPaths) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $path) -Destination (Join-Path $root $path) -Force
    }
    foreach ($path in $newScripts) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $path) -Destination (Join-Path $root $path) -Force
    }
    $stage = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @('-C', $root, 'add', '--all')
    Assert-Condition ($stage.ExitCode -eq 0) "Could not stage builder fixture: $($stage.Text)"
    return $root
}

function Invoke-BuilderStagedMutationSuite {
    $positiveRoot = New-BuilderStagedFixture -Label 'builder-staged-positive'
    $positive = Invoke-PlanningValidatorFixture -Root $positiveRoot -Mode BuilderStaged
    Assert-ProcessPass -Result $positive -Marker 'PLANNING_VALIDATION=PASS' -Label 'BuilderStaged positive'

    $script:BuilderMutationCount = 0
    $cases = @(
        @{
            Label = 'missing-path'
            Expected = 'exact nine-path correction'
            Mutate = {
                param($root)
                $result = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'restore', '--staged', '--worktree', '.planning/BLOCKERS.md'
                )
                Assert-Condition ($result.ExitCode -eq 0) $result.Text
            }
        },
        @{
            Label = 'extra-path'
            Expected = "forbids tracked path '.planning/DECISIONS.md'"
            Mutate = {
                param($root)
                [System.IO.File]::AppendAllText((Join-Path $root '.planning\DECISIONS.md'), "`nextra staged path`n")
                $result = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'add', '.planning/DECISIONS.md'
                )
                Assert-Condition ($result.ExitCode -eq 0) $result.Text
            }
        },
        @{
            Label = 'modified-new-script'
            Expected = 'must have status'
            Mutate = {
                param($root)
                $scriptPath = Join-Path $root '.planning\scripts\invoke-phase0-matrix.ps1'
                $commit = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'commit', '--quiet', '-m', 'track scripts'
                )
                Assert-Condition ($commit.ExitCode -eq 0) $commit.Text
                [System.IO.File]::AppendAllText($scriptPath, "`nmodified tracked script`n")
                $add = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'add', '.planning/scripts/invoke-phase0-matrix.ps1'
                )
                Assert-Condition ($add.ExitCode -eq 0) $add.Text
            }
        },
        @{
            Label = 'mixed-modification'
            Expected = 'must have status'
            Mutate = {
                param($root)
                [System.IO.File]::AppendAllText((Join-Path $root '.planning\STATE.md'), "`nunstaged after stage`n")
            }
        },
        @{
            Label = 'added-modified'
            Expected = 'must have status'
            Mutate = {
                param($root)
                [System.IO.File]::AppendAllText(
                    (Join-Path $root '.planning\scripts\invoke-phase0-matrix.ps1'),
                    "`nunstaged after added index entry`n"
                )
            }
        },
        @{
            Label = 'worktree-only'
            Expected = 'must have status'
            Mutate = {
                param($root)
                $result = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'restore', '--staged', '.planning/STATE.md'
                )
                Assert-Condition ($result.ExitCode -eq 0) $result.Text
            }
        },
        @{
            Label = 'new-script-unstaged'
            Expected = 'forbids ordinary untracked residue'
            Mutate = {
                param($root)
                $result = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'rm', '--cached', '--force', '.planning/scripts/invoke-phase0-matrix.ps1'
                )
                Assert-Condition ($result.ExitCode -eq 0) $result.Text
            }
        },
        @{
            Label = 'rename-path'
            Expected = 'Builder-staged'
            Mutate = {
                param($root)
                $result = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'mv', '.planning/STATE.md', '.planning/STATE-RENAMED.md'
                )
                Assert-Condition ($result.ExitCode -eq 0) $result.Text
                $stage = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'add', '--all'
                )
                Assert-Condition ($stage.ExitCode -eq 0) $stage.Text
            }
        },
        @{
            Label = 'copy-path'
            Expected = "forbids tracked path '.planning/STATE-COPY.md'"
            Mutate = {
                param($root)
                [System.IO.File]::Copy(
                    (Join-Path $root '.planning\STATE.md'),
                    (Join-Path $root '.planning\STATE-COPY.md')
                )
                $stage = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'add', '.planning/STATE-COPY.md'
                )
                Assert-Condition ($stage.ExitCode -eq 0) $stage.Text
            }
        },
        @{
            Label = 'ordinary-untracked'
            Expected = 'forbids ordinary untracked residue'
            Mutate = {
                param($root)
                [System.IO.File]::WriteAllText((Join-Path $root 'ordinary-untracked.txt'), 'residue')
            }
        },
        @{
            Label = 'ignored-residue'
            Expected = 'forbids ignored residue'
            Mutate = {
                param($root)
                [System.IO.File]::WriteAllText((Join-Path $root 'apps\web\next-env.d.ts'), '// ignored')
            }
        },
        @{
            Label = 'delete-modified-path'
            Expected = 'must have status'
            Mutate = {
                param($root)
                [System.IO.File]::Delete((Join-Path $root '.planning\STATE.md'))
                $add = Invoke-TestProcess -Executable $gitExecutable -WorkingDirectory $root -Arguments @(
                    '-C', $root, 'add', '--all'
                )
                Assert-Condition ($add.ExitCode -eq 0) $add.Text
            }
        }
    )
    foreach ($case in $cases) {
        $root = New-BuilderStagedFixture -Label ('builder-' + $case.Label)
        $null = $case.Mutate.Invoke($root)
        $result = Invoke-PlanningValidatorFixture -Root $root -Mode BuilderStaged
        Assert-ProcessFailure -Result $result -Marker $case.Expected -Label ('BuilderStaged ' + $case.Label)
        $script:BuilderMutationCount++
    }
    Write-Output "BUILDER_STAGED_MUTATIONS_PASS|positive=1|negative=$script:BuilderMutationCount|status_contract=A-space-2,M-space-7"
}

Assert-Condition (Test-Path -LiteralPath $runnerPath -PathType Leaf) "Runner is missing: $runnerPath"
Assert-Condition (Test-Path -LiteralPath $planPath -PathType Leaf) "Plan 00-12 is missing: $planPath"
Assert-Condition (
    (Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash -ceq $requiredPlanSha256
) 'Plan 00-12 hash differs from the accepted P11 input'
Assert-Condition (
    (Get-FileHash -LiteralPath $nodeExecutable -Algorithm SHA256).Hash -ceq $requiredNodeSha256
) 'Pinned Node test input hash differs'
Assert-Condition (
    (Get-FileHash -LiteralPath $npmCli -Algorithm SHA256).Hash -ceq $requiredNpmCliSha256
) 'Pinned npm CLI test input hash differs'
Assert-Condition (
    (Get-FileHash -LiteralPath $goExecutable -Algorithm SHA256).Hash -ceq $requiredGoSha256
) 'Pinned Go test input hash differs'

$planText = [System.IO.File]::ReadAllText($planPath)
$planSharpFenceMatches = [regex]::Matches(
    $planText,
    '(?ms)^```javascript\r?\n(?<script>.*?)\r?\n```[ \t]*$',
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
    [timespan]::FromSeconds(1)
)
Assert-Condition (
    $planSharpFenceMatches.Count -eq 1
) "Exact Plan 00-12 must contain one JavaScript fence; found=$($planSharpFenceMatches.Count)"
$planSharpSmokeScript = [string]$planSharpFenceMatches[0].Groups['script'].Value
Assert-Condition (
    $planSharpSmokeScript -ceq $requiredSharpSmokeScript -and
    [System.Text.UTF8Encoding]::new($false, $true).GetByteCount($planSharpSmokeScript) -eq $requiredSharpSmokeUtf8Bytes -and
    (Get-TextUtf8Sha256 -Text $planSharpSmokeScript) -ceq $requiredSharpSmokeSha256
) 'Independent Sharp smoke literal differs from the exact JavaScript fence in accepted Plan 00-12'
Write-Output "RUNNER_PLAN_SHARP_LITERAL_PASS|plan_sha256=$requiredPlanSha256|bytes=$requiredSharpSmokeUtf8Bytes|script_sha256=$requiredSharpSmokeSha256"

$statusBefore = Get-RepositoryStatus
$ignoredStatusBefore = Get-RepositoryStatus -IgnoredAware
$fingerprintBefore = Get-OwnedFileFingerprint
$runnerSource = [System.IO.File]::ReadAllText($runnerPath)
Assert-RunnerStaticContract -Source $runnerSource -Label 'canonical runner'
$testRunnerSource = [System.IO.File]::ReadAllText($PSCommandPath)
foreach ($watchdogContract in @(
    '[int]$TimeoutMilliseconds = 120000',
    '[bool]$CreateNoWindow = $true',
    '$startInfo.CreateNoWindow = $CreateNoWindow',
    '$completed = $process.WaitForExit($TimeoutMilliseconds)',
    '$process.Kill($true)',
    '$process.WaitForExit()',
    'TimedOut = -not $completed',
    'KillError = $killError'
)) {
    Assert-Condition (
        $testRunnerSource.Contains($watchdogContract)
    ) "Runner-test launcher is missing bounded process-tree watchdog contract: $watchdogContract"
}
$timeoutProbeRoot = New-TestRoot -Label 'process-tree-timeout'
$timeoutProbeChildPath = Join-Path $timeoutProbeRoot 'timeout-child.ps1'
$timeoutProbeParentPath = Join-Path $timeoutProbeRoot 'timeout-parent.ps1'
$timeoutProbeUtf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
    $timeoutProbeChildPath,
    "Start-Sleep -Seconds 300`n",
    $timeoutProbeUtf8
)
[System.IO.File]::WriteAllText(
    $timeoutProbeParentPath,
    @'
param(
    [Parameter(Mandatory)][string]$PwshPath,
    [Parameter(Mandatory)][string]$ChildScriptPath
)
$child = Start-Process `
    -FilePath $PwshPath `
    -ArgumentList @('-NoProfile', '-File', $ChildScriptPath) `
    -PassThru `
    -WindowStyle Hidden
Write-Output "TIMEOUT_CHILD_PID=$($child.Id)"
[System.Console]::Out.Flush()
Start-Sleep -Seconds 300
'@,
    $timeoutProbeUtf8
)
$timeoutProbe = Invoke-TestProcess `
    -Executable $pwshExecutable `
    -Arguments @(
        '-NoProfile',
        '-File',
        $timeoutProbeParentPath,
        '-PwshPath',
        $pwshExecutable,
        '-ChildScriptPath',
        $timeoutProbeChildPath
    ) `
    -WorkingDirectory $timeoutProbeRoot `
    -TimeoutMilliseconds 2000
Assert-Condition (
    $timeoutProbe.TimedOut -and
    $timeoutProbe.ExitCode -eq -1 -and
    $null -eq $timeoutProbe.KillError -and
    $timeoutProbe.ElapsedMilliseconds -ge 2000 -and
    $timeoutProbe.ElapsedMilliseconds -lt 10000
) "Bounded process-tree watchdog did not time out and terminate cleanly; timed_out=$($timeoutProbe.TimedOut); elapsed_ms=$($timeoutProbe.ElapsedMilliseconds); exit=$($timeoutProbe.ExitCode); kill_error=$($timeoutProbe.KillError); output=$($timeoutProbe.Text)"
$timeoutChildMatch = [regex]::Match(
    $timeoutProbe.Stdout,
    '(?m)^TIMEOUT_CHILD_PID=(?<pid>[1-9][0-9]*)\r?$'
)
Assert-Condition (
    $timeoutChildMatch.Success
) "Bounded process-tree watchdog did not capture its descendant PID; output=$($timeoutProbe.Text)"
$timeoutChildPid = [int]$timeoutChildMatch.Groups['pid'].Value
$timeoutChildStillRunning = $true
for ($probeAttempt = 0; $probeAttempt -lt 50; $probeAttempt++) {
    $timeoutChildStillRunning = $null -ne (
        Get-Process -Id $timeoutChildPid -ErrorAction SilentlyContinue
    )
    if (-not $timeoutChildStillRunning) {
        break
    }
    Start-Sleep -Milliseconds 20
}
Assert-Condition (
    -not $timeoutChildStillRunning
) "Bounded process-tree watchdog left descendant PID $timeoutChildPid running"
Write-Output (
    "RUNNER_PROCESS_TREE_WATCHDOG_PASS|timeout_ms=2000|" +
    "elapsed_ms=$($timeoutProbe.ElapsedMilliseconds)|timed_out=1|" +
    "tree_killed=1|child_pid=$timeoutChildPid|kill_error=none"
)

if (-not ('BlockXOnePhase0ConsoleCodePage' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;

public static class BlockXOnePhase0ConsoleCodePage
{
    [DllImport("kernel32.dll")]
    public static extern uint GetConsoleOutputCP();
}
'@
}
$hostConsoleEncoding = [System.Console]::OutputEncoding
$hostConsoleFingerprint = Get-TestEncodingFingerprint -Encoding $hostConsoleEncoding
$hostConsoleCodePage = [int][BlockXOnePhase0ConsoleCodePage]::GetConsoleOutputCP()
Assert-Condition (
    $hostConsoleCodePage -gt 0 -and
    $hostConsoleCodePage -eq $hostConsoleEncoding.CodePage
) "Host OS/.NET console output code pages differ before inheritance probe; os=$hostConsoleCodePage; dotnet=$($hostConsoleEncoding.CodePage)"
$capturedIbm437 = $null
try {
    [System.Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(437)
    $capturedIbm437 = [System.Console]::OutputEncoding
    $capturedIbm437Fingerprint = Get-TestEncodingFingerprint -Encoding $capturedIbm437
    $ibm437OsCodePage = [int][BlockXOnePhase0ConsoleCodePage]::GetConsoleOutputCP()
    Assert-Condition (
        $capturedIbm437.CodePage -eq 437 -and
        $ibm437OsCodePage -eq 437
    ) "Could not establish IBM437 OS/.NET console boundary; os=$ibm437OsCodePage; dotnet=$($capturedIbm437.CodePage)"
    $null = Invoke-ChildConsoleCodePageProbe `
        -Executable $pwshExecutable `
        -ExpectedCodePage 437 `
        -Label 'initial IBM437'

    $strictProbeUtf8 = [System.Text.UTF8Encoding]::new($false, $false)
    [System.Console]::OutputEncoding = $strictProbeUtf8
    $strictProbeGetter = [System.Console]::OutputEncoding
    $strictProbeOsCodePage = [int][BlockXOnePhase0ConsoleCodePage]::GetConsoleOutputCP()
    Assert-Condition (
        $strictProbeGetter.CodePage -eq 65001 -and
        $strictProbeOsCodePage -eq 65001 -and
        $strictProbeGetter.Equals($strictProbeUtf8) -and
        $strictProbeUtf8.Equals($strictProbeGetter) -and
        (Get-TestEncodingFingerprint -Encoding $strictProbeGetter) -ceq
            (Get-TestEncodingFingerprint -Encoding $strictProbeUtf8)
    ) "Could not establish BOMless replacement-fallback UTF-8 OS/.NET boundary; os=$strictProbeOsCodePage; dotnet=$($strictProbeGetter.CodePage)"
    $null = Invoke-ChildConsoleCodePageProbe `
        -Executable $pwshExecutable `
        -ExpectedCodePage 65001 `
        -Label 'assigned UTF-8'

    [System.Console]::OutputEncoding = $capturedIbm437
    $restoredIbm437 = [System.Console]::OutputEncoding
    $restoredIbm437OsCodePage = [int][BlockXOnePhase0ConsoleCodePage]::GetConsoleOutputCP()
    Assert-Condition (
        $restoredIbm437.CodePage -eq 437 -and
        $restoredIbm437OsCodePage -eq 437 -and
        $restoredIbm437.Equals($capturedIbm437) -and
        $capturedIbm437.Equals($restoredIbm437) -and
        (Get-TestEncodingFingerprint -Encoding $restoredIbm437) -ceq
            $capturedIbm437Fingerprint
    ) "Captured IBM437 OS/.NET encoding did not restore exactly; os=$restoredIbm437OsCodePage; dotnet=$($restoredIbm437.CodePage)"
    $null = Invoke-ChildConsoleCodePageProbe `
        -Executable $pwshExecutable `
        -ExpectedCodePage 437 `
        -Label 'restored IBM437'
}
finally {
    [System.Console]::OutputEncoding = $hostConsoleEncoding
}
$restoredHostConsoleEncoding = [System.Console]::OutputEncoding
$restoredHostOsCodePage = [int][BlockXOnePhase0ConsoleCodePage]::GetConsoleOutputCP()
Assert-Condition (
    $restoredHostOsCodePage -eq $hostConsoleCodePage -and
    $restoredHostConsoleEncoding.CodePage -eq $hostConsoleEncoding.CodePage -and
    $restoredHostConsoleEncoding.Equals($hostConsoleEncoding) -and
    $hostConsoleEncoding.Equals($restoredHostConsoleEncoding) -and
    (Get-TestEncodingFingerprint -Encoding $restoredHostConsoleEncoding) -ceq
        $hostConsoleFingerprint
) "Host OS/.NET console encoding did not restore exactly; expected_os=$hostConsoleCodePage; actual_os=$restoredHostOsCodePage; expected_dotnet=$($hostConsoleEncoding.CodePage); actual_dotnet=$($restoredHostConsoleEncoding.CodePage)"
$null = Invoke-ChildConsoleCodePageProbe `
    -Executable $pwshExecutable `
    -ExpectedCodePage $hostConsoleCodePage `
    -Label 'restored host'
Write-Output (
    "RUNNER_CONSOLE_INHERITANCE_RESTORE_PASS|" +
    "initial_cp437=1|assigned_utf8=1|restored_cp437=1|" +
    "outer_host_cp=$hostConsoleCodePage|outer_host_restored=1|" +
    "child_inheritance=437,65001,437,$hostConsoleCodePage|" +
    "before_type=$($hostConsoleEncoding.GetType().FullName)|" +
    "after_type=$($restoredHostConsoleEncoding.GetType().FullName)|" +
    'equals_bidirectional=1|semantic_fingerprint=exact|behavior=exact'
)

$testContractText = [System.IO.File]::ReadAllText($testContractPath)
$contractFence = [regex]::Match(
    $testContractText,
    '(?ms)## Required Phase 0 commands\b.*?```powershell\s*(?<code>.*?)\s*```'
)
Assert-Condition $contractFence.Success 'TEST-CONTRACT is missing the Required Phase 0 PowerShell fence'
$contractTokens = $null
$contractParseErrors = $null
$contractAst = [System.Management.Automation.Language.Parser]::ParseInput(
    $contractFence.Groups['code'].Value,
    [ref]$contractTokens,
    [ref]$contractParseErrors
)
Assert-Condition ($contractParseErrors.Count -eq 0) "TEST-CONTRACT PowerShell fence has parse errors: $($contractParseErrors.Message -join '; ')"
$contractCommands = @(
    $contractAst.FindAll(
        { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
        $true
    )
)
Assert-Condition ($contractAst.EndBlock.Statements.Count -eq 1) 'TEST-CONTRACT PowerShell fence must contain exactly one top-level statement'
Assert-Condition ($contractCommands.Count -eq 1) "TEST-CONTRACT PowerShell fence must contain exactly one command; found $($contractCommands.Count)"
Assert-Condition ($contractCommands[0].GetCommandName() -ceq 'pwsh') 'TEST-CONTRACT sole command must launch pwsh'
$contractCommandText = $contractCommands[0].Extent.Text
foreach ($requiredFragment in @(
    '-NoProfile',
    '-File',
    '.\.planning\scripts\invoke-phase0-matrix.ps1',
    '-NodeExecutable',
    '-NpmCli',
    '-GoExecutable',
    '-BaselineManifest',
    '-CandidateManifest',
    '-BaselineCommit',
    '-BaselineTree',
    '-CandidateCommit',
    '-CandidateTree',
    '-ToolCommit',
    '-ToolTree',
    '-ToolPath'
)) {
    Assert-Condition $contractCommandText.Contains($requiredFragment) "TEST-CONTRACT runner command is missing $requiredFragment"
}
Assert-Condition (-not $contractCommandText.Contains('-SelfTestCase')) 'TEST-CONTRACT must invoke Matrix mode, not SelfTest mode'

$maskingPattern = '(?m)^\s*\$nativeOutput = @\(& \$executablePath\.FullPath @Arguments 2>&1\)\r?\n\s*\$nativeExitCode = \$LASTEXITCODE'
$maskingReplacement = @'
        $nativeOutput = @(& $executablePath.FullPath @Arguments 2>&1)
        $maskingProbe = @(& $executablePath.FullPath @('-e', 'process.exit(0)') 2>&1)
        $nativeExitCode = $LASTEXITCODE
'@
$maskingRegex = [regex]::new($maskingPattern)
$mutatedMasking = $maskingRegex.Replace(
    $runnerSource,
    [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $maskingReplacement },
    1
)
Assert-Condition ($mutatedMasking -cne $runnerSource) 'Could not construct exit-7-then-exit-0 masking mutation'
$maskingRejected = $false
try {
    Assert-RunnerStaticContract -Source $mutatedMasking -Label 'masking mutation'
}
catch {
    $maskingRejected = $true
}
Assert-Condition $maskingRejected 'Static contract accepted a later native exit 0 before LASTEXITCODE capture'

$directMutation = $runnerSource + "`n& `$NodeExecutable --version`n"
$directRejected = $false
try {
    Assert-RunnerStaticContract -Source $directMutation -Label 'direct-native mutation'
}
catch {
    $directRejected = $true
}
Assert-Condition $directRejected 'Static contract accepted an unwrapped native invocation'

$alternateMutation = $runnerSource + "`nStart-Process -FilePath `$NodeExecutable`n"
$alternateRejected = $false
try {
    Assert-RunnerStaticContract -Source $alternateMutation -Label 'alternate-launch mutation'
}
catch {
    $alternateRejected = $true
}
Assert-Condition $alternateRejected 'Static contract accepted Start-Process'

$sharpLiteralPattern = '(?ms)(?<prefix>^\$script:RequiredSharpSmokeScript\s*=\s*)@''(?<open>\r?\n)(?<body>.*?)(?<close>\r?\n)''@'
$sharpLiteralRegex = [regex]::new(
    $sharpLiteralPattern,
    [System.Text.RegularExpressions.RegexOptions]::Multiline -bor
        [System.Text.RegularExpressions.RegexOptions]::Singleline,
    [timespan]::FromSeconds(1)
)
$sharpLiteralMatches = $sharpLiteralRegex.Matches($runnerSource)
Assert-Condition (
    $sharpLiteralMatches.Count -eq 1
) "Could not identify the sole Sharp single-quoted here-string; found=$($sharpLiteralMatches.Count)"
$sharpExpandableMutation = $sharpLiteralRegex.Replace(
    $runnerSource,
    [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        return (
            $match.Groups['prefix'].Value +
            '@"' +
            $match.Groups['open'].Value +
            $match.Groups['body'].Value +
            $match.Groups['close'].Value +
            '"@'
        )
    },
    1
)
$sharpByteMutation = $runnerSource.Replace('solid-red-rgba', 'solid-fed-rgba')
$sharpHashGateMutation = $runnerSource.Replace(
    '$hash -ceq $script:RequiredSharpSmokeSha256',
    '$hash.Length -eq 64'
)
$sharpProductionArgvMutation = $runnerSource.Replace(
    '''-e'', $sharpScript',
    '''-e'', ($sharpScript + ''x'')'
)

$labelMutations = @(
    @{
        Label = 'missing'
        Source = $runnerSource.Replace("-Label 'planning.validate'", "-Label 'planning.validate.deleted'")
    },
    @{
        Label = 'duplicate'
        Source = $runnerSource.Replace("-Label 'artifacts.validate'", "-Label 'planning.validate'")
    },
    @{
        Label = 'reordered'
        Source = $runnerSource.Replace("-Label 'planning.validate'", "-Label 'temporary.swap'").
            Replace("-Label 'artifacts.validate'", "-Label 'planning.validate'").
            Replace("-Label 'temporary.swap'", "-Label 'artifacts.validate'")
    },
    @{
        Label = 'extra'
        Source = $runnerSource + "`nInvoke-NativeChecked -Label 'unexpected.production' -Executable `$script:NodePath -Arguments @('--version') -WorkingDirectory `$script:RepositoryRoot`n"
    },
    @{
        Label = 'pinned-go-path-removed'
        Source = $runnerSource.Replace(
            '$pathParts.Add($goDirectory)',
            '# pinned Go directory removed by mutation'
        )
    },
    @{
        Label = 'gosec-semantic-check-removed'
        Source = $runnerSource.Replace(
            'Assert-GosecZeroIssues -Result $gosec',
            "Assert-OutputPattern -Result `$gosec -Pattern 'Issues\\s*:\\s*0' -Message 'mutated weak gosec check'"
        )
    },
    @{
        Label = 'sharp-interpolation-reintroduced'
        Source = $sharpExpandableMutation
    },
    @{
        Label = 'sharp-literal-byte-changed'
        Source = $sharpByteMutation
    },
    @{
        Label = 'sharp-hash-gate-weakened'
        Source = $sharpHashGateMutation
    },
    @{
        Label = 'sharp-argv-vector-weakened'
        Source = $sharpProductionArgvMutation
    }
)
foreach ($mutation in $labelMutations) {
    Assert-Condition ($mutation.Source -cne $runnerSource) "Could not construct $($mutation.Label) invocation mutation"
    $rejected = $false
    try {
        Assert-RunnerStaticContract -Source $mutation.Source -Label "$($mutation.Label) invocation mutation"
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected "Static contract accepted $($mutation.Label) production invocation mutation"
}
Write-Output 'RUNNER_AST_MUTATIONS_PASS|masking=1|direct_native=1|alternate_launch=1|missing=1|duplicate=1|reordered=1|extra=1|pinned_go_path_removed=1|gosec_semantic_removed=1|sharp_interpolation=1|sharp_byte=1|sharp_hash_gate=1|sharp_argv=1'

$bindingTokens = $null
$bindingParseErrors = $null
$bindingAst = [System.Management.Automation.Language.Parser]::ParseInput(
    $runnerSource,
    [ref]$bindingTokens,
    [ref]$bindingParseErrors
)
Assert-Condition (
    $bindingParseErrors.Count -eq 0
) "Could not parse runner for semantic binding mutations: $($bindingParseErrors.Message -join '; ')"
$productionOrchestration = Get-ProductionOrchestrationAsts `
    -Ast $bindingAst `
    -Label 'production orchestration mutation source'
$identityStatement = $productionOrchestration.IdentityCall.Parent
$runnerTestAssignment = Get-ContainingAssignmentAst `
    -Command $productionOrchestration.RunnerTestCall `
    -Label 'runner.tests orchestration mutation'
$runnerParserStatement = $productionOrchestration.RunnerParser.Parent
$matrixStatement = $productionOrchestration.MatrixCall.Parent
$statusParserStatement = $productionOrchestration.FinalStatusParser.Parent
$ignoredStatusMarkerStatement = $productionOrchestration.IgnoredStatusMarker.Parent
$matrixPassMarkerStatement = $productionOrchestration.MatrixPassMarker.Parent
foreach ($statementBinding in @(
    [pscustomobject]@{ Label = 'production identity'; Ast = $identityStatement },
    [pscustomobject]@{ Label = 'runner.tests parser'; Ast = $runnerParserStatement },
    [pscustomobject]@{ Label = 'production matrix'; Ast = $matrixStatement },
    [pscustomobject]@{ Label = 'final-status parser'; Ast = $statusParserStatement },
    [pscustomobject]@{ Label = 'ignored-aware EMPTY marker'; Ast = $ignoredStatusMarkerStatement },
    [pscustomobject]@{ Label = 'PHASE0_MATRIX_PASS marker'; Ast = $matrixPassMarkerStatement }
)) {
    Assert-Condition (
        $statementBinding.Ast -is [System.Management.Automation.Language.PipelineAst]
    ) "$($statementBinding.Label) orchestration mutation target must be a direct pipeline statement"
}

$orchestrationMutations = @(
    [pscustomobject]@{
        Label = 'identity-delete'
        Source = Remove-SourceExtent `
            -Source $runnerSource `
            -Extent $identityStatement.Extent `
            -Label 'identity delete mutation'
    },
    [pscustomobject]@{
        Label = 'identity-duplicate'
        Source = Duplicate-SourceExtent `
            -Source $runnerSource `
            -Extent $identityStatement.Extent `
            -Label 'identity duplicate mutation'
    },
    [pscustomobject]@{
        Label = 'identity-reorder'
        Source = Move-SourceExtentAfter `
            -Source $runnerSource `
            -MovingExtent $identityStatement.Extent `
            -TargetExtent $runnerTestAssignment.Extent `
            -Label 'identity reorder mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-delete'
        Source = Remove-SourceExtent `
            -Source $runnerSource `
            -Extent $matrixStatement.Extent `
            -Label 'matrix delete mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-duplicate'
        Source = Duplicate-SourceExtent `
            -Source $runnerSource `
            -Extent $matrixStatement.Extent `
            -Label 'matrix duplicate mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-reorder'
        Source = Move-SourceExtentBefore `
            -Source $runnerSource `
            -MovingExtent $matrixStatement.Extent `
            -TargetExtent $identityStatement.Extent `
            -Label 'matrix reorder mutation'
    },
    [pscustomobject]@{
        Label = 'runner-parser-after-matrix'
        Source = Move-SourceExtentAfter `
            -Source $runnerSource `
            -MovingExtent $runnerParserStatement.Extent `
            -TargetExtent $matrixStatement.Extent `
            -Label 'runner parser after matrix mutation'
    },
    [pscustomobject]@{
        Label = 'empty-marker-before-parser'
        Source = Move-SourceExtentBefore `
            -Source $runnerSource `
            -MovingExtent $ignoredStatusMarkerStatement.Extent `
            -TargetExtent $statusParserStatement.Extent `
            -Label 'EMPTY marker before final parser mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-pass-before-parser'
        Source = Move-SourceExtentBefore `
            -Source $runnerSource `
            -MovingExtent $matrixPassMarkerStatement.Extent `
            -TargetExtent $statusParserStatement.Extent `
            -Label 'PHASE0_MATRIX_PASS before final parser mutation'
    },
    [pscustomobject]@{
        Label = 'empty-marker-delete'
        Source = Remove-SourceExtent `
            -Source $runnerSource `
            -Extent $ignoredStatusMarkerStatement.Extent `
            -Label 'EMPTY marker delete mutation'
    },
    [pscustomobject]@{
        Label = 'empty-marker-duplicate'
        Source = Duplicate-SourceExtent `
            -Source $runnerSource `
            -Extent $ignoredStatusMarkerStatement.Extent `
            -Label 'EMPTY marker duplicate mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-pass-delete'
        Source = Remove-SourceExtent `
            -Source $runnerSource `
            -Extent $matrixPassMarkerStatement.Extent `
            -Label 'PHASE0_MATRIX_PASS delete mutation'
    },
    [pscustomobject]@{
        Label = 'matrix-pass-duplicate'
        Source = Duplicate-SourceExtent `
            -Source $runnerSource `
            -Extent $matrixPassMarkerStatement.Extent `
            -Label 'PHASE0_MATRIX_PASS duplicate mutation'
    }
)
$orchestrationMutationPasses = 0
foreach ($orchestrationMutation in $orchestrationMutations) {
    Assert-Condition (
        $orchestrationMutation.Source -cne $runnerSource
    ) "Could not construct $($orchestrationMutation.Label) orchestration mutation"
    $rejected = $false
    try {
        Assert-RunnerStaticContract `
            -Source $orchestrationMutation.Source `
            -Label "$($orchestrationMutation.Label) orchestration mutation"
    }
    catch {
        $rejected = $true
    }
    Assert-Condition (
        $rejected
    ) "Static contract accepted $($orchestrationMutation.Label) orchestration mutation"
    $orchestrationMutationPasses++
}
Assert-Condition (
    $orchestrationMutationPasses -eq 13
) 'Production orchestration mutation count differs from the test-owned inventory'
Write-Output 'RUNNER_ORCHESTRATION_MUTATIONS_PASS|count=13|identity_delete=1|identity_duplicate=1|identity_reorder=1|matrix_delete=1|matrix_duplicate=1|matrix_reorder=1|runner_parser_after_matrix=1|empty_marker_before_parser=1|matrix_pass_before_parser=1|empty_marker_delete=1|empty_marker_duplicate=1|matrix_pass_delete=1|matrix_pass_duplicate=1'

$baseParserBindings = @(
    Get-CheckedParserBindings -Ast $bindingAst -ParserNames $semanticParserNames -Label 'semantic binding mutation source'
)
$semanticBindingMutationCount = 0
foreach ($expectedBinding in $expectedSemanticParserBindings) {
    $binding = @(
        $baseParserBindings |
            Where-Object {
                $_.Label -ceq $expectedBinding.Label -and
                $_.Parser -ceq $expectedBinding.Parser
            }
    )
    Assert-Condition (
        $binding.Count -eq 1
    ) "Could not identify exact semantic mapping mutation target: $($expectedBinding.Label)->$($expectedBinding.Parser)"
    $commandNameExtent = $binding[0].ParserCommand.CommandElements[0].Extent
    Assert-Condition (
        $commandNameExtent.Text -ceq $expectedBinding.Parser
    ) "Semantic mapping mutation target is not the parser command token: $($expectedBinding.Label)"
    $weakenedSource = (
        $runnerSource.Substring(0, $commandNameExtent.StartOffset) +
        'Write-Output' +
        $runnerSource.Substring($commandNameExtent.EndOffset)
    )
    Assert-Condition (
        $weakenedSource -cne $runnerSource
    ) "Could not weaken semantic mapping: $($expectedBinding.Label)"
    $rejected = $false
    try {
        Assert-RunnerStaticContract `
            -Source $weakenedSource `
            -Label "semantic mapping mutation '$($expectedBinding.Label)'"
    }
    catch {
        $rejected = $true
    }
    Assert-Condition (
        $rejected
    ) "Static contract accepted missing/weakened semantic mapping: $($expectedBinding.Label)"
    $semanticBindingMutationCount++
}
Assert-Condition (
    $semanticBindingMutationCount -eq $expectedSemanticParserBindings.Count
) 'Semantic binding mutation count differs from the test-owned mapping inventory'
Write-Output "RUNNER_SEMANTIC_MAPPING_MUTATIONS_PASS|count=$semanticBindingMutationCount|generic_gate_absent=1|go_test_native_only=1"

$orderingBinding = @(
    $baseParserBindings |
        Where-Object {
            $_.Label -ceq 'planning.validate' -and
            $_.Parser -ceq 'Assert-PlanningValidatorOutput'
        }
)
Assert-Condition (
    $orderingBinding.Count -eq 1 -and
    $null -ne $orderingBinding[0].NextInvocationCommand
) 'Could not identify planning.validate parser-order mutation target'
$orderingBinding = $orderingBinding[0]
$orderingParserExtent = $orderingBinding.ParserCommand.Extent
$orderingInvocationAssignment = Get-ContainingAssignmentAst `
    -Command $orderingBinding.InvocationCommand `
    -Label 'planning.validate ordering mutation'
$orderingNextAssignment = Get-ContainingAssignmentAst `
    -Command $orderingBinding.NextInvocationCommand `
    -Label 'planning.validate next-invocation ordering mutation'
$orderingParserText = [string]$orderingParserExtent.Text
$parserBeforeInvocationMutation = (
    $runnerSource.Substring(0, $orderingInvocationAssignment.Extent.StartOffset) +
    $orderingParserText +
    [System.Environment]::NewLine +
    $runnerSource.Substring(
        $orderingInvocationAssignment.Extent.StartOffset,
        $orderingParserExtent.StartOffset - $orderingInvocationAssignment.Extent.StartOffset
    ) +
    $runnerSource.Substring($orderingParserExtent.EndOffset)
)
$parserAfterNextInvocationMutation = (
    $runnerSource.Substring(0, $orderingParserExtent.StartOffset) +
    $runnerSource.Substring(
        $orderingParserExtent.EndOffset,
        $orderingNextAssignment.Extent.EndOffset - $orderingParserExtent.EndOffset
    ) +
    [System.Environment]::NewLine +
    $orderingParserText +
    $runnerSource.Substring($orderingNextAssignment.Extent.EndOffset)
)
foreach ($orderingMutation in @(
    [pscustomobject]@{
        Label = 'parser-before-invocation'
        Source = $parserBeforeInvocationMutation
    },
    [pscustomobject]@{
        Label = 'parser-after-next-invocation'
        Source = $parserAfterNextInvocationMutation
    }
)) {
    Assert-Condition (
        $orderingMutation.Source -cne $runnerSource
    ) "Could not construct $($orderingMutation.Label) mutation"
    $rejected = $false
    try {
        Assert-RunnerStaticContract `
            -Source $orderingMutation.Source `
            -Label "$($orderingMutation.Label) ordering mutation"
    }
    catch {
        $rejected = $true
    }
    Assert-Condition (
        $rejected
    ) "Static contract accepted $($orderingMutation.Label) ordering mutation"
}
Write-Output 'RUNNER_SEMANTIC_ORDER_MUTATIONS_PASS|parser_before_invocation=1|parser_after_next_invocation=1'

$success = Invoke-RunnerSelfTestProcess -Case 'native-success'
Assert-ProcessPass -Result $success -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=native-success' -Label 'native success self-test'
$failure = Invoke-RunnerSelfTestProcess -Case 'native-failure'
Assert-ProcessFailure -Result $failure -Marker 'NATIVE_COMMAND_FAILED|label=selftest.native.failure|exit=7' -Label 'native exit-7 self-test'
Assert-Condition ($failure.ExitCode -eq 7) "Native exit-7 self-test did not preserve exit 7; exit=$($failure.ExitCode)"
Assert-Condition (
    $failure.Text.Contains('SELFTEST_PATH_RESTORED=EXACT')
) "Native exit-7 self-test did not prove exact outer PATH restoration; output=$($failure.Text)"
$encodingIbm437 = Invoke-RunnerSelfTestProcess -Case 'native-encoding-ibm437'
Assert-ProcessPass -Result $encodingIbm437 -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=native-encoding-ibm437' -Label 'IBM437 native encoding self-test'
Assert-Condition (
    $encodingIbm437.Text.Contains('NATIVE_ENCODING_SELFTEST_PASS|initial=ibm437|codepoint=2714|utf8=E29C94|outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1|semantic_failures=1|cleanup_failures=1')
) "IBM437 native encoding self-test did not prove exact UTF-8 decoding and restoration; output=$($encodingIbm437.Text)"
$encodingUtf8 = Invoke-RunnerSelfTestProcess -Case 'native-encoding-utf8'
Assert-ProcessPass -Result $encodingUtf8 -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=native-encoding-utf8' -Label 'UTF-8 native encoding self-test'
Assert-Condition (
    $encodingUtf8.Text.Contains('NATIVE_ENCODING_SELFTEST_PASS|initial=utf8|codepoint=2714|utf8=E29C94|outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1|semantic_failures=0|cleanup_failures=0')
) "UTF-8 native encoding self-test did not prove exact UTF-8 decoding and restoration; output=$($encodingUtf8.Text)"
$encodingFailure = Invoke-RunnerSelfTestProcess -Case 'native-encoding-failure'
Assert-ProcessFailure -Result $encodingFailure -Marker 'NATIVE_COMMAND_FAILED|label=selftest.encoding.native-exit7|exit=7' -Label 'native encoding exit-7 self-test'
Assert-Condition (
    $encodingFailure.ExitCode -eq 7 -and
    $encodingFailure.Text.Contains('NATIVE_ENCODING_EXIT_AUTHORITY_PASS|initial=ibm437|exit=7|codepoint=2714|utf8=E29C94|outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1')
) "Native encoding exit-7 self-test did not preserve exact output, restoration and exit authority; output=$($encodingFailure.Text)"
$parentEncodingBeforeMalformed = [System.Console]::OutputEncoding
$parentEncodingFingerprintBeforeMalformed = Get-TestEncodingFingerprint `
    -Encoding $parentEncodingBeforeMalformed
$encodingMalformed = Invoke-RunnerSelfTestProcess `
    -Case 'native-encoding-malformed' `
    -TimeoutMilliseconds 15000
$parentEncodingAfterMalformed = [System.Console]::OutputEncoding
$parentEncodingFingerprintAfterMalformed = Get-TestEncodingFingerprint `
    -Encoding $parentEncodingAfterMalformed
Assert-ProcessPass `
    -Result $encodingMalformed `
    -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=native-encoding-malformed' `
    -Label 'malformed native-byte bounded watchdog'
Assert-Condition (
    $encodingMalformed.ElapsedMilliseconds -lt 15000 -and
    $encodingMalformed.Text.Contains(
        'NATIVE_OUTPUT_REJECTED|label=selftest.encoding.malformed-byte|line=0|codepoint=FFFD'
    ) -and
    $encodingMalformed.Text.Contains(
        'NATIVE_ENCODING_MALFORMED_REJECTED|initial=ibm437|codepoint=FFFD|outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1'
    ) -and
    $parentEncodingAfterMalformed.Equals($parentEncodingBeforeMalformed) -and
    $parentEncodingBeforeMalformed.Equals($parentEncodingAfterMalformed) -and
    $parentEncodingFingerprintAfterMalformed -ceq $parentEncodingFingerprintBeforeMalformed
) "Malformed native-byte self-test did not reject replacement decoding and restore exact state; output=$($encodingMalformed.Text)"
Write-Output (
    "RUNNER_MALFORMED_BYTE_WATCHDOG_PASS|timeout_ms=15000|" +
    "elapsed_ms=$($encodingMalformed.ElapsedMilliseconds)|timed_out=0|" +
    "decode_rejected=FFFD|child_restore=exact|" +
    "parent_codepage=$($parentEncodingAfterMalformed.CodePage)|parent_restore=exact"
)

$encodingSetLine = '$null = Set-StrictUtf8NativeOutputEncoding -PriorState $priorEncodingState'
$encodingRestoreLine = 'Restore-NativeEncodingBoundary -State $priorEncodingState'
$encodingRemovedMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeChecked' `
    -Replacements @(
        [pscustomobject]@{
            Old = $encodingSetLine
            New = '# strict UTF-8 native output boundary removed by mutation'
        }
    ) `
    -Label 'native encoding set removal'
$encodingLateMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeChecked' `
    -Replacements @(
        [pscustomobject]@{
            Old = $encodingSetLine
            New = '# strict UTF-8 native output boundary delayed by mutation'
        },
        [pscustomobject]@{
            Old = '$nativeExitCode = $LASTEXITCODE'
            New = (
                '$nativeExitCode = $LASTEXITCODE' +
                [System.Environment]::NewLine +
                '        $null = Set-StrictUtf8NativeOutputEncoding -PriorState $priorEncodingState'
            )
        }
    ) `
    -Label 'native encoding late set'
$encodingRestoreMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeChecked' `
    -Replacements @(
        [pscustomobject]@{
            Old = $encodingRestoreLine
            New = "throw 'forced native encoding restoration failure mutation'"
        }
    ) `
    -Label 'native encoding restoration failure'
$encodingFallbackMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Restore-NativeEncodingBoundary' `
    -Replacements @(
        [pscustomobject]@{
            Old = '[System.Console]::OutputEncoding = $State.ConsoleOutputEncoding'
            New = @'
    $replacementEncoding = [System.Text.Encoding]::GetEncoding(
        $State.ConsoleOutputEncoding.CodePage,
        [System.Text.EncoderReplacementFallback]::new('!'),
        [System.Text.DecoderReplacementFallback]::new('!')
    )
    [System.Console]::OutputEncoding = $replacementEncoding
'@
        }
    ) `
    -Label 'native encoding fallback restoration drift'

$encodingMutationCount = 0
foreach ($encodingMutation in @(
    [pscustomobject]@{
        Label = 'set-removed'
        Source = $encodingRemovedMutation
        Expected = 'Native ibm437 decoding did not preserve exact U+2714 output'
    },
    [pscustomobject]@{
        Label = 'set-late'
        Source = $encodingLateMutation
        Expected = 'Native ibm437 decoding did not preserve exact U+2714 output'
    },
    [pscustomobject]@{
        Label = 'restore-failed'
        Source = $encodingRestoreMutation
        Expected = 'NATIVE_COMMAND_ENCODING_RESTORE_FAILED|label=selftest.encoding.ibm437.success|detail=forced native encoding restoration failure mutation'
    },
    [pscustomobject]@{
        Label = 'fallback-drift'
        Source = $encodingFallbackMutation
        Expected = 'Native output decoding boundary did not restore exact Console.OutputEncoding'
    }
)) {
    $staticRejected = $false
    try {
        Assert-RunnerStaticContract `
            -Source $encodingMutation.Source `
            -Label "native encoding $($encodingMutation.Label) mutation"
    }
    catch {
        $staticRejected = $true
    }
    Assert-Condition $staticRejected "Static contract accepted native encoding $($encodingMutation.Label) mutation"
    $fixture = New-MutatedRunnerFixture `
        -Source $encodingMutation.Source `
        -Label "native-encoding-$($encodingMutation.Label)"
    $result = Invoke-RunnerSelfTestProcess `
        -Case 'native-encoding-ibm437' `
        -Runner $fixture.Path
    Assert-ProcessFailure `
        -Result $result `
        -Marker $encodingMutation.Expected `
        -Label "native encoding $($encodingMutation.Label) executable mutation"
    Assert-Condition (
        $result.ExitCode -eq 1
    ) "Native encoding $($encodingMutation.Label) mutation did not fail closed with exit 1; exit=$($result.ExitCode)"
    if ($encodingMutation.Label -ceq 'fallback-drift') {
        Assert-Condition (
            [regex]::Matches(
                $result.Text,
                [regex]::Escape($encodingMutation.Expected),
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            ).Count -eq 1 -and
            -not $result.Text.Contains('NATIVE_COMMAND_FAILED|') -and
            -not $result.Text.Contains('NATIVE_COMMAND_ENCODING_RESTORE_FAILED|')
        ) 'Native encoding fallback-drift mutation did not fail solely on the exact restoration invariant'
    }
    $encodingMutationCount++
}

$hardcodedEncodingMarkerMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeEncodingSelfTest' `
    -Replacements @(
        [pscustomobject]@{
            Old = '"codepoint=$($successEvidence.CodePointHex)|utf8=$($successEvidence.Utf8Hex)|"'
            New = '"codepoint=2714|utf8=E29C94|"'
        }
    ) `
    -Label 'hard-coded native encoding evidence marker'
$disconnectedEncodingEvidenceMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeEncodingSelfTest' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$successEvidence = Get-LeadingUnicodeScalarEvidence -Text $success.Output[0]'
            New = '$successEvidence = Get-LeadingUnicodeScalarEvidence -Text ''✔ NATIVE_UTF8_CHECK'''
        }
    ) `
    -Label 'disconnected native encoding evidence source'
$encodingEvidenceStaticMutationCount = 0
foreach ($encodingEvidenceMutation in @(
    [pscustomobject]@{
        Label = 'hard-coded-marker'
        Source = $hardcodedEncodingMarkerMutation
    },
    [pscustomobject]@{
        Label = 'disconnected-source'
        Source = $disconnectedEncodingEvidenceMutation
    }
)) {
    $staticRejected = $false
    try {
        Assert-RunnerStaticContract `
            -Source $encodingEvidenceMutation.Source `
            -Label "native encoding $($encodingEvidenceMutation.Label) mutation"
    }
    catch {
        $staticRejected = $true
    }
    Assert-Condition (
        $staticRejected
    ) "Static contract accepted native encoding $($encodingEvidenceMutation.Label) mutation"
    $fixture = New-MutatedRunnerFixture `
        -Source $encodingEvidenceMutation.Source `
        -Label "native-encoding-evidence-$($encodingEvidenceMutation.Label)"
    $result = Invoke-RunnerSelfTestProcess `
        -Case 'native-encoding-utf8' `
        -Runner $fixture.Path
    Assert-ProcessPass `
        -Result $result `
        -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=native-encoding-utf8' `
        -Label "native encoding $($encodingEvidenceMutation.Label) runtime control"
    $encodingEvidenceStaticMutationCount++
}

$replacedEncodingCodePointMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeEncodingSelfTest' `
    -Replacements @(
        [pscustomobject]@{
            Old = 'process.stdout.write("\u2714 NATIVE_UTF8_CHECK");process.exit(0)'
            New = 'process.stdout.write("\u2713 NATIVE_UTF8_CHECK");process.exit(0)'
        },
        [pscustomobject]@{
            Old = '''✔ NATIVE_UTF8_CHECK'''
            New = '''✓ NATIVE_UTF8_CHECK'''
            ExpectedCount = 2
        }
    ) `
    -Label 'replacement native encoding code point acceptance'
$questionEncodingAcceptanceMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeEncodingSelfTest' `
    -Replacements @(
        [pscustomobject]@{
            Old = 'process.stdout.write("\u2714 NATIVE_UTF8_CHECK");process.exit(0)'
            New = 'process.stdout.write("? NATIVE_UTF8_CHECK");process.exit(0)'
        },
        [pscustomobject]@{
            Old = '''✔ NATIVE_UTF8_CHECK'''
            New = '''? NATIVE_UTF8_CHECK'''
            ExpectedCount = 2
        }
    ) `
    -Label 'question-mark native encoding acceptance'
$mojibakeEncodingAcceptanceMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Invoke-NativeEncodingSelfTest' `
    -Replacements @(
        [pscustomobject]@{
            Old = 'process.stdout.write("\u2714 NATIVE_UTF8_CHECK");process.exit(0)'
            New = 'process.stdout.write("Γ£ö NATIVE_UTF8_CHECK");process.exit(0)'
        },
        [pscustomobject]@{
            Old = '''✔ NATIVE_UTF8_CHECK'''
            New = '''Γ£ö NATIVE_UTF8_CHECK'''
            ExpectedCount = 2
        }
    ) `
    -Label 'CP437-mojibake native encoding acceptance'
$nativeFailureMutationTokens = $null
$nativeFailureMutationParseErrors = $null
$nativeFailureMutationAst = [System.Management.Automation.Language.Parser]::ParseInput(
    $runnerSource,
    [ref]$nativeFailureMutationTokens,
    [ref]$nativeFailureMutationParseErrors
)
Assert-Condition (
    $nativeFailureMutationParseErrors.Count -eq 0
) "Typed native failure output mutation source has parse errors: $($nativeFailureMutationParseErrors.Message -join '; ')"
$nativeFailureMutationFunction = Get-FunctionAst `
    -Ast $nativeFailureMutationAst `
    -Name 'Invoke-NativeChecked' `
    -Label 'typed native failure output removal'
$nativeFailureMutationConstructors = @(
    $nativeFailureMutationFunction.Body.FindAll(
        {
            param($node)
            $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
            $node.Static -and
            [string]$node.Expression.Extent.Text -ceq '[NativeCommandFailureException]' -and
            [string]$node.Member.Value -ceq 'new'
        },
        $true
    )
)
Assert-Condition (
    $nativeFailureMutationConstructors.Count -eq 1 -and
    $nativeFailureMutationConstructors[0].Arguments.Count -eq 4 -and
    [string]$nativeFailureMutationConstructors[0].Arguments[3].Extent.Text -ceq
        '@($nativeOutput | ForEach-Object { [string]$_ })'
) 'Typed native failure output mutation did not find one AST-bound NativeOutput constructor payload'
$nativeFailurePayloadExtent = $nativeFailureMutationConstructors[0].Arguments[3].Extent
$nativeFailureOutputRemovalMutation = (
    $runnerSource.Substring(0, $nativeFailurePayloadExtent.StartOffset) +
    '@()' +
    $runnerSource.Substring($nativeFailurePayloadExtent.EndOffset)
)
Assert-Condition (
    $nativeFailureOutputRemovalMutation.Contains(
        'Output = @($nativeOutput | ForEach-Object { [string]$_ })'
    ) -and
    $nativeFailureOutputRemovalMutation.Contains(
        'Text = (@($nativeOutput | ForEach-Object { [string]$_ }) -join "`n")'
    )
) 'Typed native failure output mutation changed success Result.Output or Result.Text retention'

$encodingEvidenceExecutableMutations = @(
    [pscustomobject]@{
        Label = 'codepoint-replaced'
        Source = $replacedEncodingCodePointMutation
        Case = 'native-encoding-utf8'
        Expected = 'Native utf8 decoding did not bind the exact U+2714/E29C94 scalar'
    },
    [pscustomobject]@{
        Label = 'question-accepted'
        Source = $questionEncodingAcceptanceMutation
        Case = 'native-encoding-utf8'
        Expected = 'Native utf8 decoding did not bind the exact U+2714/E29C94 scalar'
    },
    [pscustomobject]@{
        Label = 'mojibake-accepted'
        Source = $mojibakeEncodingAcceptanceMutation
        Case = 'native-encoding-utf8'
        Expected = 'Native utf8 decoding did not bind the exact U+2714/E29C94 scalar'
    },
    [pscustomobject]@{
        Label = 'native-output-removed'
        Source = $nativeFailureOutputRemovalMutation
        Case = 'native-encoding-failure'
        Expected = 'Native encoding self-test did not preserve exact U+2714 output and authoritative exit 7'
    }
)
$encodingEvidenceExecutableMutationCount = 0
foreach ($encodingEvidenceMutation in $encodingEvidenceExecutableMutations) {
    $fixture = New-MutatedRunnerFixture `
        -Source $encodingEvidenceMutation.Source `
        -Label "native-encoding-evidence-$($encodingEvidenceMutation.Label)"
    $result = Invoke-RunnerSelfTestProcess `
        -Case $encodingEvidenceMutation.Case `
        -Runner $fixture.Path
    Assert-ProcessFailure `
        -Result $result `
        -Marker $encodingEvidenceMutation.Expected `
        -Label "native encoding $($encodingEvidenceMutation.Label) executable mutation"
    Assert-Condition (
        $result.ExitCode -eq 1
    ) "Native encoding $($encodingEvidenceMutation.Label) mutation did not fail closed with exit 1; exit=$($result.ExitCode)"
    $encodingEvidenceExecutableMutationCount++
}
$nativeFailureOutputStaticRejected = $false
try {
    Assert-RunnerStaticContract `
        -Source $nativeFailureOutputRemovalMutation `
        -Label 'typed native failure output removal mutation'
}
catch {
    $nativeFailureOutputStaticRejected = $true
}
Assert-Condition (
    $nativeFailureOutputStaticRejected
) 'Static contract accepted typed native failure output removal'
Write-Output (
    "RUNNER_NATIVE_ENCODING_EVIDENCE_MUTATIONS_PASS|" +
    "static=$encodingEvidenceStaticMutationCount|executable=$encodingEvidenceExecutableMutationCount|" +
    'hardcoded_marker=1|disconnected_source=1|codepoint_replaced=1|' +
    'question_accepted=1|mojibake_accepted=1|native_output_removed=1'
)

$mojibakeAcceptedMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Get-ExpectedWebLintOutputLines' `
    -Replacements @(
        [pscustomobject]@{
            Old = "'✔ No ESLint warnings or errors'"
            New = "'Γ£ö No ESLint warnings or errors'"
        }
    ) `
    -Label 'web lint mojibake expected transcript'
$mojibakeAcceptedMutation = New-FunctionScopedMutation `
    -Source $mojibakeAcceptedMutation `
    -FunctionName 'Assert-WebLintSummary' `
    -Replacements @(
        [pscustomobject]@{
            Old = ').Count -eq 0'
            New = ').Count -ge 0'
        },
        [pscustomobject]@{
            Old = "-LabelPattern '^[ \t]*(?:✔|✓)?[ \t]*No ESLint(?:[ \t]|$)'"
            New = "-LabelPattern '^[ \t]*(?:✔|Γ£ö)?[ \t]*No ESLint(?:[ \t]|$)'"
        },
        [pscustomobject]@{
            Old = "-ExactPattern '^[ \t]*✔ No ESLint warnings or errors[ \t]*$'"
            New = "-ExactPattern '^[ \t]*Γ£ö No ESLint warnings or errors[ \t]*$'"
        }
    ) `
    -Label 'web lint mojibake parser acceptance'
$mojibakeStaticRejected = $false
try {
    Assert-RunnerStaticContract `
        -Source $mojibakeAcceptedMutation `
        -Label 'web lint mojibake acceptance mutation'
}
catch {
    $mojibakeStaticRejected = $true
}
Assert-Condition $mojibakeStaticRejected 'Static contract accepted CP437 mojibake as the ESLint success marker'
$mojibakeFixture = New-MutatedRunnerFixture `
    -Source $mojibakeAcceptedMutation `
    -Label 'web-lint-mojibake-acceptance'
$mojibakeResult = Invoke-RunnerSelfTestProcess `
    -Case 'semantic-output' `
    -Runner $mojibakeFixture.Path
Assert-ProcessFailure `
    -Result $mojibakeResult `
    -Marker 'Semantic parser accepted web lint mojibake' `
    -Label 'web lint mojibake executable mutation'
Assert-Condition (
    $mojibakeResult.ExitCode -eq 1
) "Web lint mojibake acceptance mutation did not fail closed with exit 1; exit=$($mojibakeResult.ExitCode)"
Write-Output "RUNNER_NATIVE_ENCODING_MUTATIONS_PASS|encoding=$encodingMutationCount|set_removed=1|set_late=1|restore_failed=1|mojibake_acceptance=1"

foreach ($case in @(
    'identity',
    'missing-resolution',
    'primary-cleanup',
    'cleanup-only',
    'primary-cleanup-sentinel',
    'path-tool-resolution',
    'location-restore',
    'component-root-reparse',
    'terminal-reparse',
    'ancestor-reparse',
    'temporary-root-reparse',
    'destination-ancestor-reparse',
    'destination-preexisting',
    'destination-race',
    'quarantine-root-race',
    'quarantine-reparse',
    'parent-preserves-vite'
)) {
    $result = Invoke-RunnerSelfTestProcess -Case $case
    Assert-ProcessPass -Result $result -Marker "PHASE0_RUNNER_SELFTEST_PASS|case=$case" -Label "$case self-test"
}
$gosecSemantic = Invoke-RunnerSelfTestProcess -Case 'gosec-semantic-output'
Assert-ProcessPass -Result $gosecSemantic -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=gosec-semantic-output' -Label 'gosec semantic-output self-test'
Assert-Condition (
    $gosecSemantic.Text.Contains('GOSEC_SEMANTIC_SELFTEST_PASS|esc_colored_zero=1|c1_colored_zero=1|raw_unchanged=1|negative_cases=12|native_exit7=1')
) "Gosec semantic-output self-test did not report its full positive/negative/native-exit coverage; output=$($gosecSemantic.Text)"
$semanticOutput = Invoke-RunnerSelfTestProcess -Case 'semantic-output'
Assert-ProcessPass -Result $semanticOutput -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=semantic-output' -Label 'semantic output-family self-test'
Assert-Condition (
    $semanticOutput.Text.Contains(
        'NEXT_BUILD_SEMANTIC_SELFTEST_PASS|positives=2|negatives=30|denominator=45|range=bounded|monotonic=1|final=exact-one-last|ansi_sgr=1|native_exit7=1|raw_preserved=1'
    ) -and
    $semanticOutput.Text.Contains(
        'SEMANTIC_OUTPUT_SELFTEST_PASS|families=18|numeric_negatives=14|tap_negatives=8|vitest_negatives=9|next_positives=2|next_negatives=30|web_lint_negatives=12|compile_negatives=4|hardhat_negatives=14|companion_negatives=6|raw_line_negatives=9|identity_blank_negatives=6|identity_version_negatives=4|identity_raw_negatives=8|native_exit7=1|raw_preserved=1'
    )
) "Semantic output-family self-test did not report its complete adversarial coverage; output=$($semanticOutput.Text)"
$goDiscoveryOutput = Invoke-RunnerSelfTestProcess -Case 'go-discovery-output'
Assert-ProcessPass -Result $goDiscoveryOutput -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=go-discovery-output' -Label 'Go discovery semantic self-test'
Assert-Condition (
    $goDiscoveryOutput.Text.Contains(
        'GO_DISCOVERY_SEMANTIC_SELFTEST_PASS|passes=357|tested_packages=12|no_test_packages=13|run57_no_test_events=39|run57_no_test_sha256=A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88|run57_no_test_indices_sha256=348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8|synthetic_tested_events=1559|representative_total_events=1598|positive_zero_decimal=1|elapsed_zero=11|elapsed_nonzero=2|elapsed_max=0.001|elapsed_bound_seconds=6.728|negative_cases=39|raw_preserved=1'
    )
) "Go discovery semantic self-test did not report its strict JSON/identity coverage; output=$($goDiscoveryOutput.Text)"
$sharpScriptArgument = Invoke-RunnerSelfTestProcess -Case 'sharp-script-argument'
Assert-ProcessPass -Result $sharpScriptArgument -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=sharp-script-argument' -Label 'Sharp script argument self-test'
Assert-Condition (
    $sharpScriptArgument.Text.Contains('SHARP_SCRIPT_ARGUMENT_PASS|bytes=720|sha256=99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3|backticks=2|tokens=6') -and
    $sharpScriptArgument.Text.Contains('SHARP_SCRIPT_SELFTEST_PASS|bytes=720|sha256=99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3|argv_exact=1|backticks=2|tokens=6|injection_negatives=5|native_exit7=1') -and
    $sharpScriptArgument.Text.Contains('SHARP_NATIVE_EXIT_AUTHORITY_PASS|label=selftest.sharp.native-exit7|exit=7')
) "Sharp script argument self-test did not prove literal/argv/native-exit authority; output=$($sharpScriptArgument.Text)"
$environmentAbsent = Invoke-RunnerSelfTestProcess -Case 'environment-absent' -Environment @{
    GOTOOLCHAIN = $null
}
Assert-ProcessPass -Result $environmentAbsent -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=environment-absent' -Label 'absent GOTOOLCHAIN restoration'
$environmentValued = Invoke-RunnerSelfTestProcess -Case 'environment-valued' -Environment @{
    GOTOOLCHAIN = 'selftest-prior-value'
}
Assert-ProcessPass -Result $environmentValued -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=environment-valued' -Label 'valued GOTOOLCHAIN restoration'
$webEnvironmentAbsent = Invoke-RunnerSelfTestProcess -Case 'web-environment-absent' -Environment @{
    NEXT_PUBLIC_API_URL = $null
    SERVER_ACTION_ALLOWED_ORIGINS = $null
}
Assert-ProcessPass -Result $webEnvironmentAbsent -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=web-environment-absent' -Label 'absent web environment restoration'
$webEnvironmentValued = Invoke-RunnerSelfTestProcess -Case 'web-environment-valued' -Environment @{
    NEXT_PUBLIC_API_URL = 'selftest-api-prior'
    SERVER_ACTION_ALLOWED_ORIGINS = 'selftest-origin-prior'
}
Assert-ProcessPass -Result $webEnvironmentValued -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=web-environment-valued' -Label 'valued web environment restoration'
$pathAbsent = Invoke-RunnerSelfTestProcess -Case 'path-absent' -Environment @{
    PATH = $null
    PHASE0_SELFTEST_PATH_ABSENT = '1'
}
Assert-ProcessPass -Result $pathAbsent -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=path-absent' -Label 'absent PATH restoration'
$pathValued = Invoke-RunnerSelfTestProcess -Case 'path-valued' -Environment @{
    PATH = 'selftest-path-prior'
    PHASE0_SELFTEST_PATH_VALUE = 'selftest-path-prior'
}
Assert-ProcessPass -Result $pathValued -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=path-valued' -Label 'valued PATH restoration'
Write-Output 'RUNNER_EXECUTABLE_SELFTESTS_PASS|pass_cases=31|expected_failure_cases=2'

$hostileGoPath = Join-Path $hostileGoDirectory 'go.exe'
Assert-Condition (Test-Path -LiteralPath $hostileGoPath -PathType Leaf) "Hostile ambient Go fixture does not exist: $hostileGoPath"
$hostileGoIdentity = Invoke-TestProcess -Executable $hostileGoPath -Arguments @('version') -WorkingDirectory $repoRoot -Environment @{
    GOTOOLCHAIN = 'local'
}
Assert-Condition (
    $hostileGoIdentity.ExitCode -eq 0 -and
    $hostileGoIdentity.Stdout.Trim() -match '^go version go1\.25\.10 [^/\s]+/[^/\s]+$'
) "Hostile ambient Go fixture was not exact go1.25.10; exit=$($hostileGoIdentity.ExitCode); output=$($hostileGoIdentity.Text)"
$hostileGoResolution = Invoke-RunnerSelfTestProcess -Case 'path-tool-resolution' -Environment @{
    PATH = $hostileGoDirectory
    GOTOOLCHAIN = 'local'
}
Assert-ProcessPass -Result $hostileGoResolution -Marker 'PHASE0_RUNNER_SELFTEST_PASS|case=path-tool-resolution' -Label 'hostile ambient-Go path resolution'
Assert-Condition (
    $hostileGoResolution.Text.Contains('NATIVE_OUTPUT|label=selftest.path.go.version|go version go1.26.5')
) "Hostile ambient-Go path resolution did not execute pinned Go 1.26.5; output=$($hostileGoResolution.Text)"
Write-Output 'RUNNER_HOSTILE_GO_PATH_PASS|ambient=go1.25.10|resolved=go1.26.5'

$selfTestRestorePattern = '(?m)^(?<indent>\s*)Restore-ProcessEnvironmentState -State \$script:PriorPath\r?\n(?=\s*\$restoredSelfTestPath = Get-ProcessEnvironmentState -Name ''PATH'')'
$selfTestRestoreMatches = [regex]::Matches($runnerSource, $selfTestRestorePattern)
Assert-Condition ($selfTestRestoreMatches.Count -eq 1) "Could not identify the sole self-test outer PATH restoration site; found=$($selfTestRestoreMatches.Count)"
$mutatedSelfTestRestore = [regex]::Replace(
    $runnerSource,
    $selfTestRestorePattern,
    '${indent}[System.Environment]::SetEnvironmentVariable(''PATH'', ''broken-selftest-path'', ''Process'')' + [System.Environment]::NewLine,
    [System.Text.RegularExpressions.RegexOptions]::None,
    [timespan]::FromSeconds(1)
)
Assert-Condition ($mutatedSelfTestRestore -cne $runnerSource) 'Could not construct self-test outer PATH restoration mutation'
$selfTestRestoreFixture = New-MutatedRunnerFixture -Source $mutatedSelfTestRestore -Label 'selftest-outer-path-restore'
$selfTestRestoreFailure = Invoke-RunnerSelfTestProcess -Case 'native-failure' -Runner $selfTestRestoreFixture.Path
Assert-ProcessFailure -Result $selfTestRestoreFailure -Marker 'SELFTEST_PATH_RESTORE_FAILED|Self-test outer PATH restoration was not exact' -Label 'self-test outer PATH restoration mutation'
Assert-Condition ($selfTestRestoreFailure.ExitCode -eq 1) "Self-test outer PATH restoration mutation did not fail closed with exit 1; exit=$($selfTestRestoreFailure.ExitCode)"
Assert-Condition (
    $selfTestRestoreFailure.Text.Contains('SELFTEST_PRIMARY_FAILURE_PRESERVED|NATIVE_COMMAND_FAILED|label=selftest.native.failure|exit=7')
) "Self-test outer PATH restoration mutation lost the primary native exit-7 diagnostic; output=$($selfTestRestoreFailure.Text)"
Write-Output 'RUNNER_OUTER_PATH_RESTORE_MUTATION_PASS|restore_failure=1|primary_exit7_preserved=1'

$ansiNormalizationMutation = $runnerSource.Replace(
    '$normalized = Remove-AnsiSgrForParsing -Text ([string]$rawLine)',
    '$normalized = [string]$rawLine'
)
Assert-Condition ($ansiNormalizationMutation -cne $runnerSource) 'Could not construct ANSI normalization removal mutation'
$ansiNormalizationFixture = New-MutatedRunnerFixture -Source $ansiNormalizationMutation -Label 'ansi-normalization-removed'
$ansiNormalizationFailure = Invoke-RunnerSelfTestProcess -Case 'gosec-semantic-output' -Runner $ansiNormalizationFixture.Path
Assert-ProcessFailure -Result $ansiNormalizationFailure -Marker 'output contains a non-SGR ESC/C1 control sequence' -Label 'ANSI normalization removal mutation'

$gosecExactOneMutation = $runnerSource.
    Replace('$issueLabelLines.Count -eq 1', '$issueLabelLines.Count -ge 1').
    Replace('$issueMatches.Count -eq 1', '$issueMatches.Count -ge 1')
Assert-Condition ($gosecExactOneMutation -cne $runnerSource) 'Could not construct gosec exact-one gate mutation'
$gosecExactOneFixture = New-MutatedRunnerFixture -Source $gosecExactOneMutation -Label 'gosec-exact-one-weakened'
$gosecExactOneFailure = Invoke-RunnerSelfTestProcess -Case 'gosec-semantic-output' -Runner $gosecExactOneFixture.Path
Assert-ProcessFailure -Result $gosecExactOneFailure -Marker 'gosec semantic parser accepted duplicate' -Label 'gosec exact-one gate mutation'

$gosecZeroGateMutation = $runnerSource.Replace(
    '$issueCount -eq [uint64]0',
    '$issueCount -ge [uint64]0'
)
Assert-Condition ($gosecZeroGateMutation -cne $runnerSource) 'Could not construct gosec numeric-zero gate mutation'
$gosecZeroGateFixture = New-MutatedRunnerFixture -Source $gosecZeroGateMutation -Label 'gosec-zero-gate-weakened'
$gosecZeroGateFailure = Invoke-RunnerSelfTestProcess -Case 'gosec-semantic-output' -Runner $gosecZeroGateFixture.Path
Assert-ProcessFailure -Result $gosecZeroGateFailure -Marker 'gosec semantic parser accepted colored-nonzero' -Label 'gosec numeric-zero gate mutation'
Write-Output 'RUNNER_GOSEC_SEMANTIC_MUTATIONS_PASS|normalization_removed=1|exact_one_weakened=1|zero_gate_weakened=1'

$sharedExactOneMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Get-SoleSemanticMatchForParsing' `
    -Label 'shared exact-one weakening' `
    -Replacements @(
        [pscustomobject]@{ Old = '$labelLines.Count -eq 1'; New = '$labelLines.Count -ge 1' },
        [pscustomobject]@{ Old = '$matches.Count -eq 1'; New = '$matches.Count -ge 1' }
    )

$numericSyntaxMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Convert-InvariantUInt64ForParsing' `
    -Label 'invariant numeric-style weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '[System.Globalization.NumberStyles]::None'
            New = '[System.Globalization.NumberStyles]::Integer'
        }
    )
$numericSyntaxMutation = New-FunctionScopedMutation `
    -Source $numericSyntaxMutation `
    -FunctionName 'Assert-NpmAuditZero' `
    -Label 'invariant numeric-grammar weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '(?<count>[0-9]+) vulnerabilities'
            New = '(?<count>[+-]?[0-9]+) vulnerabilities'
        }
    )

$tapExpectedCountMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-TapSummary' `
    -Label 'TAP expected-count weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$value -eq [uint64]$entry.Value'
            New = '$value -ge [uint64]0'
        }
    )

$vitestExpectedCountMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-VitestSummary' `
    -Label 'Vitest expected-count weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$passed -eq [uint64]$field.Expected'
            New = '$passed -ge [uint64]0'
        },
        [pscustomobject]@{
            Old = '$total -eq [uint64]$field.Expected'
            New = '$total -ge [uint64]0'
        }
    )

$nextDenominatorMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-NextBuildSummary' `
    -Label 'Next denominator weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$total -eq [uint64]45'
            New = '$total -ge [uint64]0'
        }
    )
$nextMonotonicMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-NextBuildSummary' `
    -Label 'Next monotonicity weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$progress.Done -gt $priorDone'
            New = '$true'
        }
    )
$nextWorkingSuffixMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-NextBuildSummary' `
    -Label 'Next working-suffix weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$first.HasPendingSuffix'
            New = '$true'
        }
    )
$nextWorkingSuffixPositionMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-NextBuildSummary' `
    -Label 'Next working-suffix position weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '-not $progress.HasPendingSuffix'
            New = '$true'
        }
    )

$hardhatAdverseMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-HardhatTestSummary' `
    -Label 'Hardhat adverse-summary weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$adverseLines.Count -eq 0'
            New = '$adverseLines.Count -ge 0'
        }
    )

$goDuplicateIdentityMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go duplicate-pass identity weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$passIdentities.Add($identity)'
            New = '$true'
        }
    )
$goNoTestElapsedBoundMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go no-test Elapsed-bound weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$elapsedSeconds -le $maxNoTestElapsedSeconds'
            New = '$true'
        }
    )
$goNoTestElapsedGrammarMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go no-test Elapsed-grammar weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '''\A(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\z'''
            New = '''^.*$'''
        }
    )
$goNoTestStateMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go no-test state-machine weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$state -eq 0'
            New = '$true'
        },
        [pscustomobject]@{
            Old = '$state -eq 1'
            New = '$true'
        },
        [pscustomobject]@{
            Old = '$state -eq 2'
            New = '$true'
        }
    )
$goNoTestPropertyOrderMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go no-test property-order weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$propertyShape -ceq ''Time,Action,Package'''
            New = '$true'
        },
        [pscustomobject]@{
            Old = '$propertyShape -ceq ''Time,Action,Package,Output'''
            New = '$true'
        },
        [pscustomobject]@{
            Old = '$propertyShape -ceq ''Time,Action,Package,Elapsed'''
            New = '$true'
        }
    )
$goNoTestExactOutputMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GoDiscovery' `
    -Label 'Go no-test exact-output weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$properties[''Output''].GetString() -ceq $expectedOutput'
            New = '$true'
        }
    )
$zeroRawBlankGateMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-ZeroRawOutput' `
    -Label 'zero-output blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 0'
            New = '$lines.Count -ge 0'
        }
    )
$exactLineBlankGateMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-ExactOutputLine' `
    -Label 'exact-output blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 1'
            New = '$lines.Count -ge 1'
        },
        [pscustomobject]@{
            Old = '$lines[0] -ceq $Expected'
            New = '$lines -contains $Expected'
        }
    )
$exactLineBlankGateMutation = New-FunctionScopedMutation `
    -Source $exactLineBlankGateMutation `
    -FunctionName 'Assert-ExactMatchingLine' `
    -Label 'exact-matching blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$blankLines.Count -eq 0'
            New = '$blankLines.Count -ge 0'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-ActionlintIdentity' `
    -Label 'actionlint identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 3'
            New = '$lines.Count -ge 3'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $identityBlankGateMutation `
    -FunctionName 'Assert-GolangciIdentity' `
    -Label 'golangci identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 1'
            New = '$lines.Count -ge 1'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $identityBlankGateMutation `
    -FunctionName 'Assert-GosecModuleIdentity' `
    -Label 'gosec identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '@($lines | Where-Object { ([string]$_).Length -eq 0 }).Count -eq 0'
            New = '@($lines | Where-Object { ([string]$_).Length -eq 0 }).Count -ge 0'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $identityBlankGateMutation `
    -FunctionName 'Assert-GovulncheckIdentity' `
    -Label 'govulncheck identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 5'
            New = '$lines.Count -ge 5'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $identityBlankGateMutation `
    -FunctionName 'Assert-DockerIdentity' `
    -Label 'Docker identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 1'
            New = '$lines.Count -ge 1'
        }
    )
$identityBlankGateMutation = New-FunctionScopedMutation `
    -Source $identityBlankGateMutation `
    -FunctionName 'Assert-GitIdentity' `
    -Label 'Git identity blank-line gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '$lines.Count -eq 1'
            New = '$lines.Count -ge 1'
        }
    )
$golangciRawControlMutation = New-FunctionScopedMutation `
    -Source $runnerSource `
    -FunctionName 'Assert-GolangciIdentity' `
    -Label 'golangci identity raw-control gate weakening' `
    -Replacements @(
        [pscustomobject]@{
            Old = '-not [regex]::IsMatch('
            New = '$true -or [regex]::IsMatch('
        }
    )

$semanticInternalMutations = @(
    [pscustomobject]@{
        Label = 'shared-exact-one'
        Source = $sharedExactOneMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted'
    },
    [pscustomobject]@{
        Label = 'invariant-numeric-syntax'
        Source = $numericSyntaxMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted npm-audit negative'
    },
    [pscustomobject]@{
        Label = 'tap-expected-counts'
        Source = $tapExpectedCountMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted TAP adverse'
    },
    [pscustomobject]@{
        Label = 'vitest-expected-counts'
        Source = $vitestExpectedCountMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Vitest negative'
    },
    [pscustomobject]@{
        Label = 'next-denominator'
        Source = $nextDenominatorMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Next progress wrong-start-total'
    },
    [pscustomobject]@{
        Label = 'next-monotonicity'
        Source = $nextMonotonicMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Next progress duplicate-intermediate'
    },
    [pscustomobject]@{
        Label = 'next-working-suffix'
        Source = $nextWorkingSuffixMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Next progress start-no-ellipsis'
    },
    [pscustomobject]@{
        Label = 'next-working-suffix-position'
        Source = $nextWorkingSuffixPositionMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Next progress nonzero-ellipsis'
    },
    [pscustomobject]@{
        Label = 'hardhat-adverse-summary'
        Source = $hardhatAdverseMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted Hardhat test negative'
    },
    [pscustomobject]@{
        Label = 'go-duplicate-pass-identity'
        Source = $goDuplicateIdentityMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery duplicate-pass'
    },
    [pscustomobject]@{
        Label = 'go-no-test-elapsed-bound'
        Source = $goNoTestElapsedBoundMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery no-test-skip-out-of-bound'
    },
    [pscustomobject]@{
        Label = 'go-no-test-elapsed-grammar'
        Source = $goNoTestElapsedGrammarMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery no-test-skip-signed-zero'
    },
    [pscustomobject]@{
        Label = 'go-no-test-state-machine'
        Source = $goNoTestStateMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery no-test-output-before-start'
    },
    [pscustomobject]@{
        Label = 'go-no-test-property-order'
        Source = $goNoTestPropertyOrderMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery no-test-skip-property-order'
    },
    [pscustomobject]@{
        Label = 'go-no-test-exact-output'
        Source = $goNoTestExactOutputMutation
        Case = 'go-discovery-output'
        Expected = 'Semantic parser accepted Go discovery wrong-no-test-output'
    },
    [pscustomobject]@{
        Label = 'zero-output-blank-line'
        Source = $zeroRawBlankGateMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted'
    },
    [pscustomobject]@{
        Label = 'exact-line-blank-line'
        Source = $exactLineBlankGateMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted'
    },
    [pscustomobject]@{
        Label = 'identity-blank-lines'
        Source = $identityBlankGateMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted'
    },
    [pscustomobject]@{
        Label = 'golangci-raw-control'
        Source = $golangciRawControlMutation
        Case = 'semantic-output'
        Expected = 'Semantic parser accepted golangci identity'
    }
)
foreach ($mutation in $semanticInternalMutations) {
    $fixture = New-MutatedRunnerFixture -Source $mutation.Source -Label ("semantic-internal-" + $mutation.Label)
    $result = Invoke-RunnerSelfTestProcess -Case $mutation.Case -Runner $fixture.Path
    Assert-ProcessFailure `
        -Result $result `
        -Marker $mutation.Expected `
        -Label "$($mutation.Label) internal semantic mutation"
}
Write-Output 'RUNNER_SEMANTIC_INTERNAL_MUTATIONS_PASS|count=22|normalization_removed=1|gosec_exact_one_weakened=1|gosec_zero_weakened=1|shared_exact_one_weakened=1|numeric_syntax_weakened=1|tap_counts_weakened=1|vitest_counts_weakened=1|next_denominator_weakened=1|next_monotonicity_weakened=1|next_working_suffix_weakened=1|next_working_suffix_position_weakened=1|hardhat_adverse_weakened=1|go_duplicate_identity_weakened=1|go_no_test_elapsed_bound_weakened=1|go_no_test_elapsed_grammar_weakened=1|go_no_test_state_machine_weakened=1|go_no_test_property_order_weakened=1|go_no_test_exact_output_weakened=1|zero_blank_gate_weakened=1|exact_line_blank_gates_weakened=1|identity_blank_gates_weakened=1|golangci_raw_control_weakened=1'

$sharpMutationCases = @(
    @{
        Label = 'sharp-interpolation-reintroduced'
        Source = $sharpExpandableMutation
        Expected = 'Sharp smoke script UTF-8 byte length mismatch'
    },
    @{
        Label = 'sharp-literal-byte-changed'
        Source = $sharpByteMutation
        Expected = 'Sharp smoke script SHA-256 mismatch'
    },
    @{
        Label = 'sharp-hash-gate-weakened'
        Source = $sharpHashGateMutation
        Expected = 'Sharp smoke integrity gate accepted an injected or altered script'
    },
    @{
        Label = 'sharp-argv-vector-weakened'
        Source = $runnerSource.Replace(
            '''-e'', $probeScript, $script:RequiredSharpSmokeScript',
            '''-e'', $probeScript, ($script:RequiredSharpSmokeScript + ''x'')'
        )
        Expected = 'NATIVE_COMMAND_FAILED|label=selftest.sharp.argv|exit=9'
    }
)
foreach ($mutation in $sharpMutationCases) {
    Assert-Condition (
        $mutation.Source -cne $runnerSource
    ) "Could not construct $($mutation.Label) executable mutation"
    $fixture = New-MutatedRunnerFixture -Source $mutation.Source -Label $mutation.Label
    $result = Invoke-RunnerSelfTestProcess -Case 'sharp-script-argument' -Runner $fixture.Path
    Assert-ProcessFailure -Result $result -Marker $mutation.Expected -Label "$($mutation.Label) executable mutation"
}
Write-Output 'RUNNER_SHARP_SCRIPT_MUTATIONS_PASS|interpolation_reintroduced=1|literal_byte_changed=1|hash_gate_weakened=1|argv_vector_weakened=1'

$invalidRoot = New-TestRoot -Label 'invalid-inputs'
$invalidDirectory = Join-Path $invalidRoot 'directory-input'
[System.IO.Directory]::CreateDirectory($invalidDirectory) | Out-Null
$missingPath = Join-Path $invalidRoot 'missing-input.bin'
foreach ($inputName in @('Node', 'Npm', 'Go')) {
    Assert-InvalidPinnedInput -InputName $inputName -InvalidPath $missingPath -ExpectedText 'does not exist'
    Assert-InvalidPinnedInput -InputName $inputName -InvalidPath $invalidDirectory -ExpectedText 'must be a leaf file'
    Assert-InvalidPinnedInput -InputName $inputName -InvalidPath 'relative-input.bin' -ExpectedText 'must be absolute'
}
$copiedNode = Join-Path $invalidRoot 'copied-node.exe'
$copiedNpm = Join-Path $invalidRoot 'copied-npm-cli.js'
$copiedGo = Join-Path $invalidRoot 'copied-go.exe'
Copy-Item -LiteralPath $nodeExecutable -Destination $copiedNode
Copy-Item -LiteralPath $npmCli -Destination $copiedNpm
Copy-Item -LiteralPath $goExecutable -Destination $copiedGo
Assert-InvalidPinnedInput -InputName 'Node' -InvalidPath $copiedNode -ExpectedText 'path mismatch'
Assert-InvalidPinnedInput -InputName 'Npm' -InvalidPath $copiedNpm -ExpectedText 'path mismatch'
Assert-InvalidPinnedInput -InputName 'Go' -InvalidPath $copiedGo -ExpectedText 'path mismatch'

$hashMutations = @(
    @{ Label = 'Node'; Hash = $requiredNodeSha256; Replacement = ('0' * 64) },
    @{ Label = 'Npm'; Hash = $requiredNpmCliSha256; Replacement = ('1' * 64) },
    @{ Label = 'Go'; Hash = $requiredGoSha256; Replacement = ('2' * 64) }
)
foreach ($mutation in $hashMutations) {
    $mutatedSource = $runnerSource.Replace($mutation.Hash, $mutation.Replacement)
    Assert-Condition ($mutatedSource -cne $runnerSource) "Could not construct $($mutation.Label) hash mutation"
    $fixture = New-MutatedRunnerFixture -Source $mutatedSource -Label ('hash-' + $mutation.Label)
    $result = Invoke-RunnerSelfTestProcess -Case 'native-success' -Runner $fixture.Path
    Assert-ProcessFailure -Result $result -Marker 'SHA-256 mismatch' -Label "$($mutation.Label) hash mutation"
}

$missingParameterResult = Invoke-TestProcess -Executable $pwshExecutable -WorkingDirectory $repoRoot -Arguments @(
    '-NoProfile',
    '-File',
    $runnerPath,
    '-NpmCli',
    $npmCli,
    '-GoExecutable',
    $goExecutable,
    '-SelfTestCase',
    'native-success'
)
Assert-ProcessFailure -Result $missingParameterResult -Marker 'NodeExecutable' -Label 'missing NodeExecutable parameter'
Write-Output 'RUNNER_PIN_INPUT_NEGATIVES_PASS|nonexistent=3|nonleaf=3|relative=3|wrong_path=3|hash=3|missing=1'

$versionMutations = @(
    @{ Label = 'node'; Old = "'v22.23.1'"; New = "'v22.23.0'"; Expected = "output must be exactly one raw line 'v22.23.0'" },
    @{ Label = 'npm'; Old = "'10.9.8'"; New = "'10.9.7'"; Expected = "output must be exactly one raw line '10.9.7'" },
    @{ Label = 'go'; Old = "'go version go1.26.5 windows/amd64'"; New = "'go version go1.26.4 windows/amd64'"; Expected = "output must be exactly one raw line 'go version go1.26.4 windows/amd64'" },
    @{
        Label = 'actionlint'
        FunctionName = 'Assert-ActionlintIdentity'
        Old = "'v1.7.12'"
        New = "'v1.7.11'"
        Expected = 'actionlint identity must be exactly three expected raw lines'
    },
    @{ Label = 'golangci'; Old = "'^golangci-lint has version 2\.12\.2 built with go1\.26\.5 from"; New = "'^golangci-lint has version 2\.12\.1 built with go1\.26\.5 from"; Expected = 'golangci-lint version/build identity must have exactly one anchored valid line' },
    @{ Label = 'gosec'; Old = 'v2\.25\.0\th1:8fN1'; New = 'v2\.24\.0\th1:8fN1'; Expected = 'gosec module version/sum must have exactly one anchored valid line' },
    @{ Label = 'govulncheck'; Old = "'^Scanner: govulncheck@v1\.6\.0$'"; New = "'^Scanner: govulncheck@v1\.5\.0$'"; Expected = 'govulncheck scanner identity must have exactly one anchored valid line' },
    @{
        Label = 'docker'
        Old = "'^Docker version (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+), build (?<build>[0-9A-Za-z]+)$'"
        New = "'^Docker release (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+), build (?<build>[0-9A-Za-z]+)$'"
        Expected = 'Docker version/build identity has invalid grammar'
    },
    @{
        Label = 'git'
        Old = "'^git version (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)(?<suffix>(?:\.[0-9A-Za-z]+)+)$'"
        New = "'^git release (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)(?<suffix>(?:\.[0-9A-Za-z]+)+)$'"
        Expected = 'Git version identity has invalid grammar'
    }
)
$versionMutationPasses = 0
foreach ($mutation in $versionMutations) {
    if ($mutation.ContainsKey('FunctionName')) {
        $mutatedSource = New-FunctionScopedMutation `
            -Source $runnerSource `
            -FunctionName $mutation.FunctionName `
            -Label "$($mutation.Label) version mutation" `
            -Replacements @(
                [pscustomobject]@{
                    Old = $mutation.Old
                    New = $mutation.New
                }
            )
    }
    else {
        Assert-Condition (
            [regex]::Matches(
                $runnerSource,
                [regex]::Escape($mutation.Old),
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            ).Count -eq 1
        ) "$($mutation.Label) version mutation target must occur exactly once"
        $mutatedSource = $runnerSource.Replace($mutation.Old, $mutation.New)
    }
    Assert-Condition ($mutatedSource -cne $runnerSource) "Could not construct $($mutation.Label) version mutation"
    $fixture = New-MutatedRunnerFixture -Source $mutatedSource -Label ('version-' + $mutation.Label)
    $result = Invoke-RunnerSelfTestProcess -Case 'identity' -Runner $fixture.Path
    Assert-ProcessFailure -Result $result -Marker $mutation.Expected -Label "$($mutation.Label) version mutation"
    $versionMutationPasses++
}
Write-Output "RUNNER_VERSION_MUTATIONS_PASS|count=$versionMutationPasses"

Invoke-PlanningMutationSuites
Invoke-BuilderStagedMutationSuite

$fingerprintAfter = Get-OwnedFileFingerprint
$statusAfter = Get-RepositoryStatus
$ignoredStatusAfter = Get-RepositoryStatus -IgnoredAware
Assert-FingerprintEqual -Before $fingerprintBefore -After $fingerprintAfter
Assert-Condition ($statusAfter -ceq $statusBefore) 'Runner tests changed ordinary repository status'
Assert-Condition ($ignoredStatusAfter -ceq $ignoredStatusBefore) 'Runner tests changed ignored-aware repository status'

$cleanBoundary = [string]::IsNullOrEmpty($statusAfter) -and [string]::IsNullOrEmpty($ignoredStatusAfter)
$statusBoundary = if ($cleanBoundary) { 'clean-i5' } else { 'preserved-builder-staged' }
Write-Output "REAL_REPOSITORY_STATE_PRESERVED|boundary=$statusBoundary|ordinary_empty=$([string]::IsNullOrEmpty($statusAfter))|ignored_aware_empty=$([string]::IsNullOrEmpty($ignoredStatusAfter))"
Write-Output "PHASE0_RUNNER_TESTS_PASS|tool_labels=$($expectedToolLabels.Count)|matrix_labels=$($expectedMatrixLabels.Count)|checked_invocations=$($expectedToolLabels.Count + $expectedMatrixLabels.Count)|release=NO-GO"
