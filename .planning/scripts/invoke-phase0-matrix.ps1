[CmdletBinding(DefaultParameterSetName = 'Matrix')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [Parameter(Mandatory, ParameterSetName = 'SelfTest')]
    [string]$NodeExecutable,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [Parameter(Mandatory, ParameterSetName = 'SelfTest')]
    [string]$NpmCli,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [Parameter(Mandatory, ParameterSetName = 'SelfTest')]
    [string]$GoExecutable,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [string]$BaselineManifest,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [string]$CandidateManifest,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$BaselineCommit,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$BaselineTree,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$CandidateCommit,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$CandidateTree,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ToolCommit,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ToolTree,

    [Parameter(Mandatory, ParameterSetName = 'Matrix')]
    [string]$ToolPath,

    [Parameter(Mandatory, ParameterSetName = 'SelfTest')]
    [ValidateSet(
        'identity',
         'native-success',
         'native-failure',
         'native-encoding-ibm437',
         'native-encoding-utf8',
         'native-encoding-failure',
         'native-encoding-malformed',
         'missing-resolution',
        'primary-cleanup',
        'cleanup-only',
        'primary-cleanup-sentinel',
        'environment-absent',
        'environment-valued',
        'web-environment-absent',
        'web-environment-valued',
        'path-absent',
        'path-valued',
        'path-tool-resolution',
        'gosec-semantic-output',
        'semantic-output',
        'go-discovery-output',
        'sharp-script-argument',
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
    )]
    [string]$SelfTestCase
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7 or later is required; found $($PSVersionTable.PSVersion)."
}
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $true
}

class NativeCommandFailureException : System.Exception {
    [string]$CommandLabel
    [int]$NativeExitCode
    [string[]]$NativeOutput

    NativeCommandFailureException(
        [string]$commandLabel,
        [int]$nativeExitCode,
        [string]$detail,
        [string[]]$nativeOutput
    ) : base(
        "NATIVE_COMMAND_FAILED|label=$commandLabel|exit=$nativeExitCode|detail=$detail"
    ) {
        $this.CommandLabel = $commandLabel
        $this.NativeExitCode = $nativeExitCode
        $this.NativeOutput = @($nativeOutput)
    }
}

$script:RequiredNodeSha256 = 'F8D162C0641DCEE512132F3BCF8A68169C7ECB852EFD8E1A46C9FEC5A0F469ED'
$script:RequiredNpmCliSha256 = '8E5F6F3429F8CDBE693CDC29904E9D5A7B127A494BD15C804BD54C7403BFCBE7'
$script:RequiredGoSha256 = 'D6A71E6DC9806CB3F1FCB817D562175C5A7B1505FC3F6638299648E0B9F0F74F'
$script:RequiredNpmShimSha256 = '225730FB64FF01F37EB6D2CCA0003C314DE19BC6D72A06E2AB9649B24362603E'
$script:RequiredNodePath = 'C:\Users\danie\AppData\Local\npm-cache\_npx\d295cebdb7c54afe\node_modules\node\bin\node.exe'
$script:RequiredNpmCliPath = 'C:\Users\danie\AppData\Local\npm-cache\_npx\d8f2e63c6145eb9d\node_modules\npm\bin\npm-cli.js'
$script:RequiredGoPath = 'C:\Users\danie\go\pkg\mod\golang.org\toolchain@v0.0.1-go1.26.5.windows-amd64\bin\go.exe'
$script:RequiredSharpSmokeUtf8Bytes = 720
$script:RequiredSharpSmokeSha256 = '99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3'
$script:RequiredSharpSmokeScript = @'
(async()=>{const sharp=require('./apps/web/node_modules/sharp');const pixel=[255,0,0,255];const input=Buffer.from(Array(6).fill(pixel).flat());const png=await sharp(input,{raw:{width:2,height:3,channels:4}}).png().toBuffer();const meta=await sharp(png).metadata();const versions=sharp.versions;if(png.length!==95||meta.format!=='png'||meta.width!==2||meta.height!==3||versions.sharp!=='0.35.3'||versions.vips!=='8.18.3')throw new Error(JSON.stringify({bytes:png.length,meta,versions}));console.log(`SHARP_SMOKE_PASS|fixture=solid-red-rgba|bytes=${png.length}|format=${meta.format}|width=${meta.width}|height=${meta.height}|sharp=${versions.sharp}|vips=${versions.vips}`)})().catch(e=>{console.error(e);process.exit(1)});
'@
$script:RequiredBaselineSha256 = '7C5CED696A38C2DEB5AFEFB70A61B8F3D0E87AD341905A31137ACFDC522359E0'
$script:RequiredCandidateSha256 = 'CF45D49FE9CCD30A48ACAB71229AAC05A4E09AA9F36600BD82B5CF26D59CC186'
$script:RequiredComparisonSha256 = '9D75271BB9A9E87D410D98DC9EAE4F0ADAA8597B7D55E4A72324EC2BEA78AF62'
$script:RequiredBaselineCommit = 'a88658ad82f3d22aaf26e10b9eab6389084e6dd3'
$script:RequiredBaselineTree = '13492dba6a709db7d093052824c5ddb3ee8c58e9'
$script:RequiredCandidateCommit = '2a55a5fbf51a2018a650122eff313f3ce4e63dff'
$script:RequiredCandidateTree = '6b9f6672001b0f9d14d0dcb19756b206db2974cd'
$script:RequiredToolCommit = '2a55a5fbf51a2018a650122eff313f3ce4e63dff'
$script:RequiredToolTree = '6b9f6672001b0f9d14d0dcb19756b206db2974cd'
$script:RequiredToolPath = 'contracts/scripts/capture-bytecode-manifest.mjs'

# This is the exact Plan 00-12 inventory. The isolated AST tests compare every
# production invocation to these arrays and reject missing, duplicate,
# reordered, or extra labels.
$script:ToolCommandLabels = @(
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
$script:MatrixCommandLabels = @(
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

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-PathPrefix {
    param([Parameter(Mandatory)][string]$Path)

    return $Path.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
}

function Assert-NonReparsePathChain {
    param(
        [Parameter(Mandatory)][string]$Path,
        [switch]$MustExist,
        [ValidateSet('Any', 'File', 'Directory')]
        [string]$ExpectedType = 'Any',
        [string]$Label = 'path'
    )

    Assert-Condition ([System.IO.Path]::IsPathFullyQualified($Path)) "$Label must be absolute: $Path"
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $volumeRoot = [System.IO.Path]::GetPathRoot($fullPath)
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($volumeRoot)) "$Label has no filesystem volume: $fullPath"

    $current = $volumeRoot
    $rootEntry = Get-Item -LiteralPath $current -Force -ErrorAction Stop
    Assert-Condition (
        -not ($rootEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    ) "$Label traverses a reparse-point volume root: $current"

    $relative = $fullPath.Substring($volumeRoot.Length)
    $separatorCharacters = [char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $segments = @(
        $relative.Split(
            $separatorCharacters,
            [System.StringSplitOptions]::RemoveEmptyEntries
        )
    )
    $entry = $rootEntry
    for ($index = 0; $index -lt $segments.Count; $index++) {
        $segment = $segments[$index]
        Assert-Condition $entry.PSIsContainer "$Label traverses through a non-directory: $current"
        $children = @(
            Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop |
                Where-Object {
                    $_.Name.Equals($segment, [System.StringComparison]::OrdinalIgnoreCase)
                }
        )
        Assert-Condition ($children.Count -le 1) "$Label has an ambiguous lexical component: $segment"
        if ($children.Count -eq 0) {
            if ($MustExist) {
                throw "$Label does not exist: $(Join-Path $current $segment)"
            }
            return [pscustomobject]@{
                Exists = $false
                FullPath = $fullPath
                Entry = $null
            }
        }
        $entry = $children[0]
        $current = $entry.FullName
        Assert-Condition (
            -not ($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        ) "$Label traverses a reparse point: $current"
    }

    if ($ExpectedType -ceq 'File') {
        Assert-Condition (-not $entry.PSIsContainer) "$Label must be a leaf file: $fullPath"
    }
    elseif ($ExpectedType -ceq 'Directory') {
        Assert-Condition $entry.PSIsContainer "$Label must be a directory: $fullPath"
    }

    return [pscustomobject]@{
        Exists = $true
        FullPath = $fullPath
        Entry = $entry
    }
}

function Assert-LeafHash {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedSha256,
        [Parameter(Mandatory)][string]$Label,
        [string]$ExpectedPath
    )

    $resolved = Assert-NonReparsePathChain -Path $Path -MustExist -ExpectedType File -Label $Label
    if (-not [string]::IsNullOrWhiteSpace($ExpectedPath)) {
        $required = [System.IO.Path]::GetFullPath($ExpectedPath)
        Assert-Condition (
            $resolved.FullPath.Equals($required, [System.StringComparison]::OrdinalIgnoreCase)
        ) "$Label path mismatch; expected=$required; actual=$($resolved.FullPath)"
    }
    $actualHash = (Get-FileHash -LiteralPath $resolved.FullPath -Algorithm SHA256).Hash
    Assert-Condition (
        $actualHash -ceq $ExpectedSha256
    ) "$Label SHA-256 mismatch; expected=$ExpectedSha256; actual=$actualHash; path=$($resolved.FullPath)"
    return $resolved.FullPath
}

function Resolve-ExternalApplication {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$RequiredSuffix
    )

    $commandName = if ($IsWindows) { "$Name.exe" } else { $Name }
    $commands = @(
        Get-Command -Name $commandName -CommandType Application -All -ErrorAction Stop
    )
    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($command in $commands) {
        $source = [string]$command.Source
        if ([string]::IsNullOrWhiteSpace($source)) {
            continue
        }
        try {
            $resolved = Assert-NonReparsePathChain -Path $source -MustExist -ExpectedType File -Label "$Name application"
            $candidate = $resolved.FullPath
            if (
                -not [string]::IsNullOrWhiteSpace($RequiredSuffix) -and
                -not $candidate.EndsWith($RequiredSuffix, [System.StringComparison]::OrdinalIgnoreCase)
            ) {
                continue
            }
            if (-not $candidates.Contains($candidate)) {
                $candidates.Add($candidate)
            }
        }
        catch {
            continue
        }
    }

    Assert-Condition (
        $candidates.Count -eq 1
    ) "Expected exactly one canonical external $Name application; found=[$($candidates -join ', ')]"
    return $candidates[0]
}

function Get-ProcessEnvironmentState {
    param([Parameter(Mandatory)][string]$Name)

    return [pscustomobject]@{
        Name = $Name
        Present = Test-Path -LiteralPath "Env:$Name"
        Value = [System.Environment]::GetEnvironmentVariable($Name, 'Process')
    }
}

function Restore-ProcessEnvironmentState {
    param([Parameter(Mandatory)][object]$State)

    if ($State.Present) {
        [System.Environment]::SetEnvironmentVariable($State.Name, $State.Value, 'Process')
    }
    else {
        $environmentPath = 'Env:' + $State.Name
        if (Test-Path -LiteralPath $environmentPath) {
            Remove-Item -LiteralPath $environmentPath -Force -ErrorAction Stop
        }
    }
}

function Test-EnvironmentStateEqual {
    param(
        [Parameter(Mandatory)][object]$Left,
        [Parameter(Mandatory)][object]$Right
    )

    if ($Left.Present -ne $Right.Present) {
        return $false
    }
    if (-not $Left.Present) {
        return $true
    }
    return [string]::Equals(
        [string]$Left.Value,
        [string]$Right.Value,
        [System.StringComparison]::Ordinal
    )
}

function Get-Utf8Sha256 {
    param([Parameter(Mandatory)][string]$Text)

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    return [System.Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($utf8.GetBytes($Text))
    )
}

function Assert-SharpSmokeScriptIntegrity {
    param([Parameter(Mandatory)][string]$Script)

    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $bytes = $utf8.GetBytes($Script)
    $hash = Get-Utf8Sha256 -Text $Script
    $backtickCount = @($Script.ToCharArray() | Where-Object { [int]$_ -eq 96 }).Count
    $interpolationTokens = @(
        '${png.length}',
        '${meta.format}',
        '${meta.width}',
        '${meta.height}',
        '${versions.sharp}',
        '${versions.vips}'
    )

    Assert-Condition (
        $bytes.Length -eq $script:RequiredSharpSmokeUtf8Bytes
    ) "Sharp smoke script UTF-8 byte length mismatch; expected=$script:RequiredSharpSmokeUtf8Bytes; actual=$($bytes.Length)"
    Assert-Condition (
        $hash -ceq $script:RequiredSharpSmokeSha256
    ) "Sharp smoke script SHA-256 mismatch; expected=$script:RequiredSharpSmokeSha256; actual=$hash"
    Assert-Condition ($backtickCount -eq 2) "Sharp smoke script must preserve exactly two backticks; found=$backtickCount"
    foreach ($token in $interpolationTokens) {
        Assert-Condition (
            $Script.IndexOf($token, [System.StringComparison]::Ordinal) -ge 0
        ) "Sharp smoke script lost literal interpolation token: $token"
    }
    Assert-Condition (
        [regex]::Matches(
            $Script,
            '\$\{',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        ).Count -eq $interpolationTokens.Count
    ) "Sharp smoke script must preserve exactly $($interpolationTokens.Count) literal interpolation tokens"

    return [pscustomobject]@{
        Utf8Bytes = $bytes.Length
        Sha256 = $hash
        Backticks = $backtickCount
        InterpolationTokens = $interpolationTokens.Count
    }
}

function Get-EncodingBytesProbe {
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

function Get-EncodingTextProbe {
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

function Get-EncodingFingerprint {
    param([Parameter(Mandatory)][System.Text.Encoding]$Encoding)

    $fingerprintUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
    $encoderReplacement = if ($Encoding.EncoderFallback -is [System.Text.EncoderReplacementFallback]) {
        [System.Convert]::ToHexString(
            $fingerprintUtf8.GetBytes($Encoding.EncoderFallback.DefaultString)
        )
    }
    else {
        ''
    }
    $decoderReplacement = if ($Encoding.DecoderFallback -is [System.Text.DecoderReplacementFallback]) {
        [System.Convert]::ToHexString(
            $fingerprintUtf8.GetBytes($Encoding.DecoderFallback.DefaultString)
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
        "encode_u2714=$(Get-EncodingBytesProbe -Encoding $Encoding -Text ([string][char]0x2714))"
        "encode_unpaired_d800=$(Get-EncodingBytesProbe -Encoding $Encoding -Text ([string][char]0xD800))"
        "decode_e29c94=$(Get-EncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0xE2, 0x9C, 0x94)))"
        "decode_80=$(Get-EncodingTextProbe -Encoding $Encoding -Bytes ([byte[]](0x80)))"
    ) -join '|'
}

function Get-NativeEncodingBoundaryState {
    $consoleOutput = [System.Console]::OutputEncoding
    $consoleInput = [System.Console]::InputEncoding
    $powerShellOutput = $OutputEncoding
    return [pscustomobject]@{
        ConsoleOutputEncoding = $consoleOutput
        ConsoleInputEncoding = $consoleInput
        PowerShellOutputEncoding = $powerShellOutput
        ConsoleOutputRuntimeType = $consoleOutput.GetType().AssemblyQualifiedName
        ConsoleInputRuntimeType = $consoleInput.GetType().AssemblyQualifiedName
        PowerShellOutputRuntimeType = $powerShellOutput.GetType().AssemblyQualifiedName
        ConsoleOutputFingerprint = Get-EncodingFingerprint -Encoding $consoleOutput
        ConsoleInputFingerprint = Get-EncodingFingerprint -Encoding $consoleInput
        PowerShellOutputFingerprint = Get-EncodingFingerprint -Encoding $powerShellOutput
    }
}

function Set-StrictUtf8NativeOutputEncoding {
    param([Parameter(Mandatory)][object]$PriorState)

    $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $false)
    [System.Console]::OutputEncoding = $strictUtf8
    $effective = Get-NativeEncodingBoundaryState
    Assert-Condition (
        $effective.ConsoleOutputEncoding.Equals($strictUtf8) -and
        $strictUtf8.Equals($effective.ConsoleOutputEncoding) -and
        $effective.ConsoleOutputFingerprint -ceq (Get-EncodingFingerprint -Encoding $strictUtf8) -and
        [System.Console]::OutputEncoding.CodePage -eq 65001 -and
        [System.Console]::OutputEncoding.WebName -ceq 'utf-8' -and
        [System.Console]::OutputEncoding.GetPreamble().Length -eq 0 -and
        [System.Console]::OutputEncoding.EncoderFallback -is [System.Text.EncoderReplacementFallback] -and
        [System.Console]::OutputEncoding.DecoderFallback -is [System.Text.DecoderReplacementFallback]
    ) 'Native output decoding boundary is not BOMless replacement-fallback UTF-8'
    Assert-Condition (
        $effective.ConsoleInputEncoding.Equals($PriorState.ConsoleInputEncoding) -and
        $PriorState.ConsoleInputEncoding.Equals($effective.ConsoleInputEncoding) -and
        $effective.ConsoleInputFingerprint -ceq $PriorState.ConsoleInputFingerprint
    ) 'Native output decoding boundary changed Console.InputEncoding'
    Assert-Condition (
        $effective.PowerShellOutputEncoding.Equals($PriorState.PowerShellOutputEncoding) -and
        $PriorState.PowerShellOutputEncoding.Equals($effective.PowerShellOutputEncoding) -and
        $effective.PowerShellOutputFingerprint -ceq $PriorState.PowerShellOutputFingerprint
    ) 'Native output decoding boundary changed the PowerShell OutputEncoding preference'
}

function Restore-NativeEncodingBoundary {
    param([Parameter(Mandatory)][object]$State)

    [System.Console]::OutputEncoding = $State.ConsoleOutputEncoding
    $restored = Get-NativeEncodingBoundaryState
    Assert-Condition (
        $restored.ConsoleOutputEncoding.Equals($State.ConsoleOutputEncoding) -and
        $State.ConsoleOutputEncoding.Equals($restored.ConsoleOutputEncoding) -and
        $restored.ConsoleOutputFingerprint -ceq $State.ConsoleOutputFingerprint
    ) 'Native output decoding boundary did not restore exact Console.OutputEncoding'
    Assert-Condition (
        $restored.ConsoleInputEncoding.Equals($State.ConsoleInputEncoding) -and
        $State.ConsoleInputEncoding.Equals($restored.ConsoleInputEncoding) -and
        $restored.ConsoleInputFingerprint -ceq $State.ConsoleInputFingerprint
    ) 'Native output decoding boundary changed Console.InputEncoding'
    Assert-Condition (
        $restored.PowerShellOutputEncoding.Equals($State.PowerShellOutputEncoding) -and
        $State.PowerShellOutputEncoding.Equals($restored.PowerShellOutputEncoding) -and
        $restored.PowerShellOutputFingerprint -ceq $State.PowerShellOutputFingerprint
    ) 'Native output decoding boundary changed the PowerShell OutputEncoding preference'
}

function Invoke-NativeChecked {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$Executable,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    $executablePath = Assert-NonReparsePathChain -Path $Executable -MustExist -ExpectedType File -Label "$Label executable"
    $workingPath = Assert-NonReparsePathChain -Path $WorkingDirectory -MustExist -ExpectedType Directory -Label "$Label working directory"
    $originalLocation = [System.IO.Path]::GetFullPath((Get-Location).Path)
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $nativeOutput = @()
    $nativeExitCode = -2147483648
    $locationRestoreError = $null
    $encodingRestoreError = $null
    $decodeBoundaryError = $null
    $priorErrorActionPreference = $ErrorActionPreference
    $priorEncodingState = Get-NativeEncodingBoundaryState

    Write-Host (
        "NATIVE_COMMAND_START|label=$Label|cwd=$($workingPath.FullPath)|executable=$($executablePath.FullPath)|arguments=" +
        ($Arguments | ConvertTo-Json -Compress)
    )
    try {
        Set-Location -LiteralPath $workingPath.FullPath
        $null = Set-StrictUtf8NativeOutputEncoding -PriorState $priorEncodingState
        # PSNativeCommandUseErrorActionPreference is enabled globally. Continue
        # is bounded to this one launch so the explicit adjacent capture below
        # remains authoritative even when the native process exits nonzero.
        $ErrorActionPreference = 'Continue'
        try {
            $nativeOutput = @(& $executablePath.FullPath @Arguments 2>&1)
            $nativeExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $priorErrorActionPreference
        }
        for ($lineIndex = 0; $lineIndex -lt $nativeOutput.Count; $lineIndex++) {
            $lineText = [string]$nativeOutput[$lineIndex]
            $replacementIndex = $lineText.IndexOf([char]0xFFFD)
            $bomIndex = $lineText.IndexOf([char]0xFEFF)
            if ($replacementIndex -ge 0 -or $bomIndex -ge 0) {
                $rejectedCodePoint = if (
                    $replacementIndex -ge 0 -and
                    ($bomIndex -lt 0 -or $replacementIndex -le $bomIndex)
                ) {
                    'FFFD'
                }
                else {
                    'FEFF'
                }
                if ($null -eq $decodeBoundaryError) {
                    $decodeBoundaryError = "line=$lineIndex|codepoint=$rejectedCodePoint"
                }
                Write-Host "NATIVE_OUTPUT_REJECTED|label=$Label|line=$lineIndex|codepoint=$rejectedCodePoint"
                continue
            }
            Write-Host "NATIVE_OUTPUT|label=$Label|$lineText"
        }
    }
    finally {
        $ErrorActionPreference = $priorErrorActionPreference
        try {
            Set-Location -LiteralPath $originalLocation
        }
        catch {
            $locationRestoreError = $_
        }
        try {
            Restore-NativeEncodingBoundary -State $priorEncodingState
        }
        catch {
            $encodingRestoreError = $_
        }
        $stopwatch.Stop()
    }

    if ($nativeExitCode -ne 0) {
        $detail = if ($null -ne $decodeBoundaryError) {
            "native-output-decode-rejected;$decodeBoundaryError"
        }
        elseif ($nativeOutput.Count -gt 0) {
            ([string]$nativeOutput[-1]).Replace("`r", ' ').Replace("`n", ' ')
        }
        else {
            'no-output'
        }
        if ($null -ne $locationRestoreError) {
            $detail += "; location-restore=$($locationRestoreError.Exception.Message)"
        }
        if ($null -ne $encodingRestoreError) {
            $detail += "; encoding-restore=$($encodingRestoreError.Exception.Message)"
        }
        throw [NativeCommandFailureException]::new(
            $Label,
            $nativeExitCode,
            $detail,
            @($nativeOutput | ForEach-Object { [string]$_ })
        )
    }
    if ($null -ne $encodingRestoreError) {
        $detail = $encodingRestoreError.Exception.Message
        if ($null -ne $locationRestoreError) {
            $detail += "; location-restore=$($locationRestoreError.Exception.Message)"
        }
        if ($null -ne $decodeBoundaryError) {
            $detail += "; decode-boundary=$decodeBoundaryError"
        }
        throw "NATIVE_COMMAND_ENCODING_RESTORE_FAILED|label=$Label|detail=$detail"
    }
    if ($null -ne $locationRestoreError) {
        $detail = $locationRestoreError.Exception.Message
        if ($null -ne $decodeBoundaryError) {
            $detail += "; decode-boundary=$decodeBoundaryError"
        }
        throw "NATIVE_COMMAND_LOCATION_RESTORE_FAILED|label=$Label|detail=$detail"
    }
    if ($null -ne $decodeBoundaryError) {
        throw "NATIVE_COMMAND_UTF8_DECODE_REJECTED|label=$Label|$decodeBoundaryError"
    }

    Write-Host "NATIVE_COMMAND_PASS|label=$Label|exit=0|elapsed_ms=$($stopwatch.ElapsedMilliseconds)"
    return [pscustomobject]@{
        Label = $Label
        ExitCode = $nativeExitCode
        Output = @($nativeOutput | ForEach-Object { [string]$_ })
        Text = (@($nativeOutput | ForEach-Object { [string]$_ }) -join "`n")
        ElapsedMilliseconds = $stopwatch.ElapsedMilliseconds
    }
}

function Invoke-NpmChecked {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    return Invoke-NativeChecked -Label $Label -Executable $script:NodePath -Arguments @(
        $script:NpmCliPath
        $Arguments
    ) -WorkingDirectory $WorkingDirectory
}

function Invoke-GoChecked {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Assert-Condition (
        $env:GOTOOLCHAIN -ceq 'local'
    ) "$Label requires in-process GOTOOLCHAIN=local"
    return Invoke-NativeChecked -Label $Label -Executable $script:GoPath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Invoke-PwshChecked {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    return Invoke-NativeChecked -Label $Label -Executable $script:PwshPath -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Remove-AnsiSgrForParsing {
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Text
    )

    return [regex]::Replace(
        $Text,
        '(?:\x1B\[|\x9B)[0-?]*[ -/]*m',
        '',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
        [timespan]::FromSeconds(1)
    )
}

function Get-RawOutputLines {
    param([Parameter(Mandatory)][object]$Result)

    if (
        $null -ne $Result.PSObject.Properties['Output'] -and
        $null -ne $Result.Output
    ) {
        return @($Result.Output | ForEach-Object { [string]$_ })
    }

    return @(
        [regex]::Split(
            [string]$Result.Text,
            '\r\n|\n|\r',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
    )
}

function Get-AnsiNormalizedOutputLinesForParsing {
    param([Parameter(Mandatory)][object]$Result)

    $normalizedLines = [System.Collections.Generic.List[string]]::new()
    foreach ($rawLine in @(Get-RawOutputLines -Result $Result)) {
        $normalized = Remove-AnsiSgrForParsing -Text ([string]$rawLine)
        Assert-Condition (
            -not [regex]::IsMatch(
                $normalized,
                '[\x1B\x80-\x9F]',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            )
        ) "$($Result.Label): output contains a non-SGR ESC/C1 control sequence"
        $normalizedLines.Add($normalized)
    }
    return @($normalizedLines)
}

function Convert-InvariantUInt64ForParsing {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][string]$Label
    )

    [uint64]$value = 0
    $parsed = [uint64]::TryParse(
        $Text,
        [System.Globalization.NumberStyles]::None,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$value
    )
    Assert-Condition $parsed "$Label is not a bounded invariant ASCII UInt64: $Text"
    return $value
}

function Get-SoleSemanticMatchForParsing {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$LabelPattern,
        [Parameter(Mandatory)][string]$ExactPattern,
        [Parameter(Mandatory)][string]$FieldLabel
    )

    $options = [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    $timeout = [timespan]::FromSeconds(1)
    $labelLines = [System.Collections.Generic.List[string]]::new()
    $matches = [System.Collections.Generic.List[System.Text.RegularExpressions.Match]]::new()
    foreach ($line in $Lines) {
        if ([regex]::IsMatch($line, $LabelPattern, $options, $timeout)) {
            $labelLines.Add($line)
        }
        $match = [regex]::Match($line, $ExactPattern, $options, $timeout)
        if ($match.Success) {
            $matches.Add($match)
        }
    }
    Assert-Condition (
        $labelLines.Count -eq 1
    ) "$($Result.Label): $FieldLabel must have exactly one label-bearing line; found=$($labelLines.Count)"
    Assert-Condition (
        $matches.Count -eq 1
    ) "$($Result.Label): $FieldLabel must have exactly one anchored valid line; found=$($matches.Count)"
    return $matches[0]
}

function Assert-RawSoleLinePattern {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$LabelPattern,
        [Parameter(Mandatory)][string]$ExactPattern,
        [Parameter(Mandatory)][string]$FieldLabel
    )

    $lines = @(Get-RawOutputLines -Result $Result)
    return Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern $LabelPattern `
        -ExactPattern $ExactPattern `
        -FieldLabel $FieldLabel
}

function Assert-NormalizedSoleLinePattern {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$LabelPattern,
        [Parameter(Mandatory)][string]$ExactPattern,
        [Parameter(Mandatory)][string]$FieldLabel
    )

    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    return Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern $LabelPattern `
        -ExactPattern $ExactPattern `
        -FieldLabel $FieldLabel
}

function Assert-GosecZeroIssues {
    param([Parameter(Mandatory)][object]$Result)

    $regexTimeout = [timespan]::FromSeconds(1)
    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    $issueLabelLines = [System.Collections.Generic.List[string]]::new()
    $issueMatches = [System.Collections.Generic.List[System.Text.RegularExpressions.Match]]::new()
    foreach ($line in $lines) {
        if (
            [regex]::IsMatch(
                $line,
                '^[ \t]*Issues[ \t]*:',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                $regexTimeout
            )
        ) {
            $issueLabelLines.Add([string]$line)
        }
        $issueMatch = [regex]::Match(
            $line,
            '^[ \t]*Issues[ \t]*:[ \t]*(?<count>[0-9]+)[ \t]*$',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            $regexTimeout
        )
        if ($issueMatch.Success) {
            $issueMatches.Add($issueMatch)
        }
    }
    Assert-Condition (
        $issueLabelLines.Count -eq 1
    ) "$($Result.Label): gosec must report exactly one Issues label line; found=$($issueLabelLines.Count)"
    Assert-Condition (
        $issueMatches.Count -eq 1
    ) "$($Result.Label): gosec must report exactly one exact Issues integer field; found=$($issueMatches.Count)"
    $countText = $issueMatches[0].Groups['count'].Value
    [uint64]$issueCount = 0
    $parsed = [uint64]::TryParse(
        $countText,
        [System.Globalization.NumberStyles]::None,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$issueCount
    )
    Assert-Condition (
        $parsed
    ) "$($Result.Label): gosec Issues integer is invalid or overflows UInt64: $countText"
    Assert-Condition (
        $issueCount -eq [uint64]0
    ) "$($Result.Label): gosec reported nonzero issues: $issueCount"
}

function Assert-ExactOutputLine {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$Expected
    )

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1 -and $lines[0] -ceq $Expected
    ) "$($Result.Label) output must be exactly one raw line '$Expected'; actual_count=$($lines.Count); actual=[$($lines -join '; ')]"
}

function Assert-ExactMatchingLine {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][string]$Expected
    )

    $lines = @(Get-RawOutputLines -Result $Result)
    $blankLines = @($lines | Where-Object { ([string]$_).Length -eq 0 })
    Assert-Condition (
        $blankLines.Count -eq 0
    ) "$($Result.Label) must not contain blank raw output lines; found=$($blankLines.Count)"
    $matches = @(
        $lines |
            Where-Object { ([string]$_) -ceq $Expected }
    )
    Assert-Condition (
        $matches.Count -eq 1
    ) "$($Result.Label) must contain exactly one line '$Expected'; actual=[$($Result.Output -join '; ')]"
}

function Assert-GoVersionIdentity {
    param([Parameter(Mandatory)][object]$Result)

    Assert-ExactOutputLine -Result $Result -Expected 'go version go1.26.5 windows/amd64'
}

function Assert-ActionlintIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 3 -and
        $lines[0] -ceq 'v1.7.12' -and
        $lines[1] -ceq 'installed by building from source' -and
        $lines[2] -ceq 'built with go1.26.5 compiler for windows/amd64'
    ) "$($Result.Label): actionlint identity must be exactly three expected raw lines"
}

function Assert-GolangciIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1
    ) "$($Result.Label): golangci-lint identity must be exactly one raw line; found=$($lines.Count)"
    Assert-Condition (
        -not [regex]::IsMatch(
            $lines[0],
            '[\x00-\x1F\x7F-\x9F]',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
    ) "$($Result.Label): golangci-lint identity contains a raw control character"
    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^golangci-lint has version(?:[ \t]|$)' `
        -ExactPattern '^golangci-lint has version 2\.12\.2 built with go1\.26\.5 from \([^()\r\n]+\) on \([^()\r\n]+\)$' `
        -FieldLabel 'golangci-lint version/build identity'
}

function Assert-GosecModuleIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        @($lines | Where-Object { ([string]$_).Length -eq 0 }).Count -eq 0
    ) "$($Result.Label): gosec module identity contains blank raw lines"
    foreach ($line in $lines) {
        Assert-Condition (
            -not [regex]::IsMatch(
                $line,
                '[\x00-\x08\x0A-\x1F\x7F-\x9F]',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            )
        ) "$($Result.Label): gosec module identity contains a raw control character other than required tab separators"
    }
    $null = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^[ \t]*path[ \t]+' `
        -ExactPattern '^\tpath\tgithub\.com/securego/gosec/v2/cmd/gosec$' `
        -FieldLabel 'gosec executable module path'
    $null = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^[ \t]*mod[ \t]+github\.com/securego/gosec/v2(?:[ \t]|$)' `
        -ExactPattern '^\tmod\tgithub\.com/securego/gosec/v2\tv2\.25\.0\th1:8fN1/16qO0aA3ktgU9nDW5PdrCPd4vgpgaPM8ZE\+aEA=$' `
        -FieldLabel 'gosec module version/sum'
}

function Assert-GovulncheckIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 5 -and $lines[4] -ceq ''
    ) "$($Result.Label): govulncheck identity must be four fields followed by one exact blank terminator"
    foreach ($field in @(
        @{ Label = '^Go:'; Exact = '^Go: go1\.26\.5$'; Name = 'govulncheck Go identity' },
        @{ Label = '^Scanner:'; Exact = '^Scanner: govulncheck@v1\.6\.0$'; Name = 'govulncheck scanner identity' },
        @{ Label = '^DB:'; Exact = '^DB: https://vuln\.go\.dev$'; Name = 'govulncheck database identity' }
    )) {
        $null = Get-SoleSemanticMatchForParsing `
            -Result $Result `
            -Lines $lines `
            -LabelPattern $field.Label `
            -ExactPattern $field.Exact `
            -FieldLabel $field.Name
    }
    $timestampMatch = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^DB updated:' `
        -ExactPattern '^DB updated: (?<timestamp>[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} \+0000 UTC)$' `
        -FieldLabel 'govulncheck database UTC timestamp'
    [datetime]$timestamp = [datetime]::MinValue
    $parsed = [datetime]::TryParseExact(
        $timestampMatch.Groups['timestamp'].Value,
        "yyyy-MM-dd HH:mm:ss '+0000 UTC'",
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
            [System.Globalization.DateTimeStyles]::AdjustToUniversal,
        [ref]$timestamp
    )
    Assert-Condition $parsed "$($Result.Label): govulncheck DB timestamp is invalid"
}

function Assert-DockerIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1
    ) "$($Result.Label): Docker identity must be exactly one raw line; found=$($lines.Count)"
    $match = [regex]::Match(
        $lines[0],
        '^Docker version (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+), build (?<build>[0-9A-Za-z]+)$',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
        [timespan]::FromSeconds(1)
    )
    Assert-Condition $match.Success "$($Result.Label): Docker version/build identity has invalid grammar"
    foreach ($component in @('major', 'minor', 'patch')) {
        $null = Convert-InvariantUInt64ForParsing `
            -Text $match.Groups[$component].Value `
            -Label "$($Result.Label): Docker $component version component"
    }
    Write-Output (
        "TOOL_VERSION_IDENTITY|tool=docker|version=" +
        "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$($match.Groups['patch'].Value)|" +
        "build=$($match.Groups['build'].Value)"
    )
}

function Assert-GitIdentity {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1
    ) "$($Result.Label): Git identity must be exactly one raw line; found=$($lines.Count)"
    $match = [regex]::Match(
        $lines[0],
        '^git version (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)(?<suffix>(?:\.[0-9A-Za-z]+)+)$',
        [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
        [timespan]::FromSeconds(1)
    )
    Assert-Condition $match.Success "$($Result.Label): Git version identity has invalid grammar"
    foreach ($component in @('major', 'minor', 'patch')) {
        $null = Convert-InvariantUInt64ForParsing `
            -Text $match.Groups[$component].Value `
            -Label "$($Result.Label): Git $component version component"
    }
    Write-Output (
        "TOOL_VERSION_IDENTITY|tool=git|version=" +
        "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$($match.Groups['patch'].Value)" +
        "$($match.Groups['suffix'].Value)"
    )
}

function Assert-PlanningValidatorOutput {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    $expectedKeys = @(
        'PLANNING_VALIDATION',
        'MILESTONE',
        'PHASES',
        'PLANS',
        'GSD_ARTIFACT_STATE',
        'GSD_ARTIFACT_PROGRESS',
        'REPOSITORY_RESIDUE_MODE',
        'AUTHORITATIVE_PRODUCTION_PROGRESS',
        'ACTIVE_REQUIREMENTS',
        'CHECKED_REQUIREMENTS'
    )
    Assert-Condition (
        $lines.Count -eq $expectedKeys.Count
    ) "$($Result.Label): planning validator must emit exactly $($expectedKeys.Count) raw fields; found=$($lines.Count)"

    $values = [System.Collections.Generic.Dictionary[string,string]]::new(
        [System.StringComparer]::Ordinal
    )
    for ($index = 0; $index -lt $lines.Count; $index++) {
        $match = [regex]::Match(
            $lines[$index],
            '^(?<key>[A-Z][A-Z0-9_]*)=(?<value>[^\r\n]*)$',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
        Assert-Condition $match.Success "$($Result.Label): malformed planning field: $($lines[$index])"
        $key = $match.Groups['key'].Value
        Assert-Condition (
            $key -ceq $expectedKeys[$index]
        ) "$($Result.Label): planning field order/key mismatch at $index; expected=$($expectedKeys[$index]); actual=$key"
        Assert-Condition (
            $values.TryAdd($key, $match.Groups['value'].Value)
        ) "$($Result.Label): duplicate planning field: $key"
    }

    $expectedLiterals = [ordered]@{
        PLANNING_VALIDATION = 'PASS'
        MILESTONE = 'v2.0 Production-Ready Rebuild'
        GSD_ARTIFACT_STATE = 'partial'
        REPOSITORY_RESIDUE_MODE = 'CleanCandidate'
    }
    foreach ($entry in $expectedLiterals.GetEnumerator()) {
        Assert-Condition (
            $values[$entry.Key] -ceq $entry.Value
        ) "$($Result.Label): $($entry.Key) must be exactly '$($entry.Value)'"
    }
    foreach ($entry in @(
        @{ Key = 'PHASES'; Expected = [uint64]12; Percent = $false },
        @{ Key = 'PLANS'; Expected = [uint64]12; Percent = $false },
        @{ Key = 'GSD_ARTIFACT_PROGRESS'; Expected = [uint64]8; Percent = $true },
        @{ Key = 'AUTHORITATIVE_PRODUCTION_PROGRESS'; Expected = [uint64]0; Percent = $true },
        @{ Key = 'ACTIVE_REQUIREMENTS'; Expected = [uint64]89; Percent = $false },
        @{ Key = 'CHECKED_REQUIREMENTS'; Expected = [uint64]0; Percent = $false }
    )) {
        $pattern = if ($entry.Percent) { '^(?<value>[0-9]+)%$' } else { '^(?<value>[0-9]+)$' }
        $match = [regex]::Match(
            $values[$entry.Key],
            $pattern,
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
        Assert-Condition $match.Success "$($Result.Label): $($entry.Key) has malformed numeric syntax"
        $value = Convert-InvariantUInt64ForParsing -Text $match.Groups['value'].Value -Label "$($Result.Label): $($entry.Key)"
        Assert-Condition (
            $value -eq $entry.Expected
        ) "$($Result.Label): $($entry.Key) expected=$($entry.Expected); actual=$value"
    }
}

function Assert-ArtifactValidatorOutput {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1
    ) "$($Result.Label): artifact validator must emit exactly one raw line; found=$($lines.Count)"
    $match = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^Repository artifact policy valid:' `
        -ExactPattern '^Repository artifact policy valid: (?<paths>[0-9]+) tracked paths across (?<commits>[0-9]+) HEAD-reachable commit\(s\); modes, prohibited classes and LFS signals are clean\.$' `
        -FieldLabel 'repository artifact validator summary'
    $paths = Convert-InvariantUInt64ForParsing -Text $match.Groups['paths'].Value -Label "$($Result.Label): tracked paths"
    $commits = Convert-InvariantUInt64ForParsing -Text $match.Groups['commits'].Value -Label "$($Result.Label): reachable commits"
    Assert-Condition (
        $paths -gt [uint64]0 -and $commits -gt [uint64]0
    ) "$($Result.Label): artifact counts must both be positive; paths=$paths; commits=$commits"
}

function Assert-CiPolicyOutput {
    param([Parameter(Mandatory)][object]$Result)

    Assert-ExactOutputLine -Result $Result -Expected 'CI policy valid: mandatory checks propagate failure and deployment remains explicitly blocked.'
}

function Assert-ComposePolicyOutput {
    param([Parameter(Mandatory)][object]$Result)

    Assert-ExactOutputLine -Result $Result -Expected 'Production Compose contract valid: migrate, api, web, worker; 29 required variables fail closed.'
}

function Assert-GolangciZeroIssues {
    param([Parameter(Mandatory)][object]$Result)

    $match = Assert-NormalizedSoleLinePattern `
        -Result $Result `
        -LabelPattern '^[ \t]*[^ \t\r\n]+[ \t]+issues?(?:[ \t]*\.[ \t]*|[ \t]|$)' `
        -ExactPattern '^[ \t]*(?<count>[0-9]+)[ \t]+issues\.[ \t]*$' `
        -FieldLabel 'golangci-lint issue summary'
    $count = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): issue count"
    Assert-Condition ($count -eq [uint64]0) "$($Result.Label): golangci-lint reported $count issues"
}

function Assert-GovulnReachableZero {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    $null = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^[ \t]*(?:[^ \t\r\n]+[ \t]+)?vulnerabilities[ \t]+found(?:[ \t]*\.|[ \t]|$)' `
        -ExactPattern '^[ \t]*No vulnerabilities found\.[ \t]*$' `
        -FieldLabel 'govulncheck no-reachable-vulnerabilities marker'
    $match = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^[ \t]*Your code is affected by(?:[ \t]|$)' `
        -ExactPattern '^[ \t]*Your code is affected by (?<count>[0-9]+) vulnerabilities\.[ \t]*$' `
        -FieldLabel 'govulncheck reachable vulnerability count'
    $count = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): reachable vulnerability count"
    Assert-Condition ($count -eq [uint64]0) "$($Result.Label): code is affected by $count reachable vulnerabilities"
}

function Assert-NpmInstallSummary {
    param([Parameter(Mandatory)][object]$Result)

    $match = Assert-NormalizedSoleLinePattern `
        -Result $Result `
        -LabelPattern '^[ \t]*added(?:[ \t]|$)' `
        -ExactPattern '^[ \t]*added (?<count>[0-9]+) packages in (?<duration>[0-9]+(?:\.[0-9]+)?(?:ms|s|m))[ \t]*$' `
        -FieldLabel 'npm clean-install package summary'
    $count = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): installed package count"
    Assert-Condition ($count -gt [uint64]0) "$($Result.Label): npm clean install reported no installed packages"
}

function Assert-TapSummary {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][uint64]$ExpectedTests
    )

    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    $planMatch = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^1\.\.' `
        -ExactPattern '^1\.\.(?<count>[0-9]+)$' `
        -FieldLabel 'TAP plan'
    $plan = Convert-InvariantUInt64ForParsing -Text $planMatch.Groups['count'].Value -Label "$($Result.Label): TAP plan count"
    Assert-Condition ($plan -eq $ExpectedTests) "$($Result.Label): TAP plan expected=$ExpectedTests; actual=$plan"

    $expected = [ordered]@{
        tests = $ExpectedTests
        suites = [uint64]0
        pass = $ExpectedTests
        fail = [uint64]0
        cancelled = [uint64]0
        skipped = [uint64]0
        todo = [uint64]0
    }
    foreach ($entry in $expected.GetEnumerator()) {
        $escaped = [regex]::Escape([string]$entry.Key)
        $match = Get-SoleSemanticMatchForParsing `
            -Result $Result `
            -Lines $lines `
            -LabelPattern "^# $escaped(?:[ \t]|$)" `
            -ExactPattern "^# $escaped (?<count>[0-9]+)$" `
            -FieldLabel "TAP $($entry.Key) field"
        $value = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): TAP $($entry.Key)"
        Assert-Condition (
            $value -eq [uint64]$entry.Value
        ) "$($Result.Label): TAP $($entry.Key) expected=$($entry.Value); actual=$value"
    }
}

function Assert-VitestSummary {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][uint64]$ExpectedTests,
        [Parameter(Mandatory)][uint64]$ExpectedFiles
    )

    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    foreach ($field in @(
        @{ Label = 'Test Files'; Expected = $ExpectedFiles },
        @{ Label = 'Tests'; Expected = $ExpectedTests }
    )) {
        $escaped = [regex]::Escape([string]$field.Label)
        $match = Get-SoleSemanticMatchForParsing `
            -Result $Result `
            -Lines $lines `
            -LabelPattern "^[ \t]*$escaped(?:[ \t]|$)" `
            -ExactPattern "^[ \t]*$escaped[ \t]+(?<passed>[0-9]+)[ \t]+passed[ \t]+\((?<total>[0-9]+)\)[ \t]*$" `
            -FieldLabel "Vitest $($field.Label) summary"
        $passed = Convert-InvariantUInt64ForParsing -Text $match.Groups['passed'].Value -Label "$($Result.Label): $($field.Label) passed"
        $total = Convert-InvariantUInt64ForParsing -Text $match.Groups['total'].Value -Label "$($Result.Label): $($field.Label) total"
        Assert-Condition (
            $passed -eq [uint64]$field.Expected -and
            $total -eq [uint64]$field.Expected
        ) "$($Result.Label): Vitest $($field.Label) expected=$($field.Expected)/$($field.Expected); actual=$passed/$total"
    }

    $createdMatch = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^BLOCKXONE_HERMETIC_CACHE_CREATED=' `
        -ExactPattern '^BLOCKXONE_HERMETIC_CACHE_CREATED=(?<path>[^\x00-\x1F\x7F]+)$' `
        -FieldLabel 'hermetic cache-created marker'
    $cleanedMatch = Get-SoleSemanticMatchForParsing `
        -Result $Result `
        -Lines $lines `
        -LabelPattern '^BLOCKXONE_HERMETIC_CACHE_CLEANED=' `
        -ExactPattern '^BLOCKXONE_HERMETIC_CACHE_CLEANED=(?<path>[^\x00-\x1F\x7F]+)$' `
        -FieldLabel 'hermetic cache-cleaned marker'
    Assert-Condition (
        $createdMatch.Groups['path'].Value -ceq $cleanedMatch.Groups['path'].Value
    ) "$($Result.Label): hermetic cache create/cleanup paths differ"

    Assert-WebToolchainPreflightOutput -Result $Result
}

function Assert-WebToolchainPreflightOutput {
    param([Parameter(Mandatory)][object]$Result)

    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^Web toolchain preflight passed with Node(?:[ \t]|$)' `
        -ExactPattern '^Web toolchain preflight passed with Node 22\.23\.1 and npm 10\.9\.8\.$' `
        -FieldLabel 'web toolchain preflight identity'
}

function Get-ExpectedWebLintOutputLines {
    return @(
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
}

function Assert-WebLintSummary {
    param([Parameter(Mandatory)][object]$Result)

    Assert-WebToolchainPreflightOutput -Result $Result
    $lines = @(Get-RawOutputLines -Result $Result)
    foreach ($line in $lines) {
        Assert-Condition (
            -not [regex]::IsMatch(
                $line,
                '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            )
        ) "$($Result.Label): npm/Next lint output contains a control character"
    }
    Assert-Condition (
        @(
            $lines |
                Where-Object {
                    $_.IndexOf(
                        'Γ£ö No ESLint warnings or errors',
                        [System.StringComparison]::Ordinal
                    ) -ge 0
                }
        ).Count -eq 0
    ) "$($Result.Label): rejected CP437 mojibake for the required U+2714 ESLint clean summary"
    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^[ \t]*(?:✔|✓)?[ \t]*No ESLint(?:[ \t]|$)' `
        -ExactPattern '^[ \t]*✔ No ESLint warnings or errors[ \t]*$' `
        -FieldLabel 'Next ESLint clean summary'
    $expected = @(Get-ExpectedWebLintOutputLines)
    Assert-Condition (
        $lines.Count -eq $expected.Count
    ) "$($Result.Label): npm/Next lint output line count differs; expected=$($expected.Count); actual=$($lines.Count)"
    for ($index = 0; $index -lt $expected.Count; $index++) {
        Assert-Condition (
            $lines[$index] -ceq $expected[$index]
        ) "$($Result.Label): npm/Next lint output differs at line $index; expected=[$($expected[$index])]; actual=[$($lines[$index])]"
    }
}

function Assert-NpmAuditZero {
    param([Parameter(Mandatory)][object]$Result)

    $match = Assert-NormalizedSoleLinePattern `
        -Result $Result `
        -LabelPattern '^[ \t]*found(?:[ \t]|$)' `
        -ExactPattern '^[ \t]*found (?<count>[0-9]+) vulnerabilities[ \t]*$' `
        -FieldLabel 'npm audit vulnerability summary'
    $count = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): npm audit vulnerability count"
    Assert-Condition ($count -eq [uint64]0) "$($Result.Label): npm audit reported $count vulnerabilities"
}

function Assert-NextBuildSummary {
    param([Parameter(Mandatory)][object]$Result)

    Assert-WebToolchainPreflightOutput -Result $Result
    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    $progressLines = [System.Collections.Generic.List[object]]::new()
    $labelLineCount = 0
    foreach ($line in $lines) {
        $literalMatches = [regex]::Matches(
            $line,
            'Generating static pages',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
        if ($literalMatches.Count -eq 0) {
            continue
        }
        Assert-Condition (
            $literalMatches.Count -eq 1
        ) "$($Result.Label): static-page progress phrase must occur exactly once on a classified line"
        $labelLineCount++
        $match = [regex]::Match(
            $line,
            '^[ \t]*(?<complete>✓[ \t]+)?Generating static pages[ \t]+\((?<done>0|[1-9][0-9]*)/(?<total>0|[1-9][0-9]*)\)(?<pending> \.\.\.)?[ \t]*$',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
        Assert-Condition $match.Success "$($Result.Label): malformed static-page progress line: $line"
        $done = Convert-InvariantUInt64ForParsing -Text $match.Groups['done'].Value -Label "$($Result.Label): generated static pages"
        $total = Convert-InvariantUInt64ForParsing -Text $match.Groups['total'].Value -Label "$($Result.Label): total static pages"
        Assert-Condition (
            $total -eq [uint64]45 -and $done -le $total
        ) "$($Result.Label): invalid static-page progress $done/$total"
        $progressLines.Add(
            [pscustomobject]@{
                Done = $done
                Total = $total
                HasCompletionMark = $match.Groups['complete'].Success
                HasPendingSuffix = $match.Groups['pending'].Success
            }
        )
    }
    Assert-Condition (
        $labelLineCount -eq $progressLines.Count -and $progressLines.Count -ge 2
    ) "$($Result.Label): static-page progress requires classified start and final records"
    $first = $progressLines[0]
    Assert-Condition (
        $first.Done -eq [uint64]0 -and
        -not $first.HasCompletionMark -and
        $first.HasPendingSuffix
    ) "$($Result.Label): first static-page record must be unchecked canonical 0/45 with exact ASCII working suffix"
    $last = $progressLines[$progressLines.Count - 1]
    Assert-Condition (
        $last.Done -eq [uint64]45 -and
        $last.HasCompletionMark -and
        -not $last.HasPendingSuffix
    ) "$($Result.Label): last static-page record must be checked canonical 45/45 without a working suffix"
    $startCount = @(
        $progressLines |
            Where-Object { $_.Done -eq [uint64]0 }
    ).Count
    $finalCount = @(
        $progressLines |
            Where-Object {
                $_.Done -eq [uint64]45 -and $_.HasCompletionMark
            }
    ).Count
    Assert-Condition (
        $startCount -eq 1 -and $finalCount -eq 1
    ) "$($Result.Label): static-page start and checked final must each occur exactly once; start=$startCount; final=$finalCount"
    [uint64]$priorDone = 0
    for ($index = 1; $index -lt $progressLines.Count; $index++) {
        $progress = $progressLines[$index]
        Assert-Condition (
            $progress.Done -gt $priorDone
        ) "$($Result.Label): static-page progress did not increase strictly from $priorDone to $($progress.Done)"
        if ($index -lt ($progressLines.Count - 1)) {
            Assert-Condition (
                $progress.Done -ge [uint64]1 -and
                $progress.Done -le [uint64]44 -and
                -not $progress.HasCompletionMark -and
                -not $progress.HasPendingSuffix
            ) "$($Result.Label): intermediate static-page records must be unchecked canonical 1..44/45 without a working suffix"
        }
        $priorDone = $progress.Done
    }
}

function Assert-ProductionContainmentOutput {
    param([Parameter(Mandatory)][object]$Result)

    Assert-WebToolchainPreflightOutput -Result $Result
    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^Production containment probe(?:[ \t]|$)' `
        -ExactPattern '^Production containment probe passed; captured exact-tree cleanup completed and its loopback port stably refused connections\.$' `
        -FieldLabel 'production containment completion/cleanup marker'
}

function Assert-ContractsPreflightOutput {
    param([Parameter(Mandatory)][object]$Result)

    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^Contracts toolchain preflight passed with Node(?:[ \t]|$)' `
        -ExactPattern '^Contracts toolchain preflight passed with Node 22\.23\.1 and npm 10\.9\.8\.$' `
        -FieldLabel 'contracts toolchain preflight identity'
}

function Assert-HardhatCompileSummary {
    param([Parameter(Mandatory)][object]$Result)

    Assert-ContractsPreflightOutput -Result $Result
    $match = Assert-NormalizedSoleLinePattern `
        -Result $Result `
        -LabelPattern '^[ \t]*Compiled(?:[ \t]|$)' `
        -ExactPattern '^[ \t]*Compiled (?<count>[0-9]+) Solidity files with solc 0\.8\.20 \(evm target: shanghai\)[ \t]*$' `
        -FieldLabel 'Hardhat compile identity/count summary'
    $count = Convert-InvariantUInt64ForParsing -Text $match.Groups['count'].Value -Label "$($Result.Label): compiled Solidity files"
    Assert-Condition ($count -eq [uint64]27) "$($Result.Label): expected 27 compiled Solidity files; actual=$count"
}

function Assert-HardhatTestSummary {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][uint64]$ExpectedTests
    )

    Assert-ContractsPreflightOutput -Result $Result
    $lines = @(Get-AnsiNormalizedOutputLinesForParsing -Result $Result)
    $aggregateLabelLines = [System.Collections.Generic.List[string]]::new()
    $aggregateMatches = [System.Collections.Generic.List[System.Text.RegularExpressions.Match]]::new()
    $adverseLines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines) {
        if (
            [regex]::IsMatch(
                $line,
                '^[ \t]*[^ \t\r\n]+[ \t]+passing[^\r\n]*nodejs[^\r\n]*$',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            )
        ) {
            $aggregateLabelLines.Add($line)
        }
        $match = [regex]::Match(
            $line,
            '^[ \t]*(?<passed>[0-9]+)[ \t]+passing[ \t]+\((?<nodejs>[0-9]+)[ \t]+nodejs\)[ \t]*$',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
            [timespan]::FromSeconds(1)
        )
        if ($match.Success) {
            $aggregateMatches.Add($match)
        }
        if (
            [regex]::IsMatch(
                $line,
                '^[ \t]*[^ \t\r\n]+[ \t]+(?:pending|failing|skipped|todo)(?:[ \t]|\(|$)',
                [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                [timespan]::FromSeconds(1)
            )
        ) {
            $adverseLines.Add($line)
        }
    }
    Assert-Condition (
        $aggregateLabelLines.Count -eq 1
    ) "$($Result.Label): Hardhat nodejs passing aggregate must have exactly one label-bearing line; found=$($aggregateLabelLines.Count)"
    Assert-Condition (
        $aggregateMatches.Count -eq 1
    ) "$($Result.Label): Hardhat nodejs passing aggregate must have exactly one valid line; found=$($aggregateMatches.Count)"
    Assert-Condition (
        $adverseLines.Count -eq 0
    ) "$($Result.Label): Hardhat test output contains pending/failing/skipped/todo summaries: [$($adverseLines -join '; ')]"
    $passed = Convert-InvariantUInt64ForParsing -Text $aggregateMatches[0].Groups['passed'].Value -Label "$($Result.Label): passing tests"
    $nodejs = Convert-InvariantUInt64ForParsing -Text $aggregateMatches[0].Groups['nodejs'].Value -Label "$($Result.Label): nodejs tests"
    Assert-Condition (
        $passed -eq $ExpectedTests -and $nodejs -eq $ExpectedTests
    ) "$($Result.Label): Hardhat expected=$ExpectedTests/$ExpectedTests; actual=$passed/$nodejs"
}

function Assert-BytecodeComparatorOutput {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 1
    ) "$($Result.Label): bytecode comparator must emit exactly one raw line; found=$($lines.Count)"
    $null = Assert-RawSoleLinePattern `
        -Result $Result `
        -LabelPattern '^Compared(?:[ \t]|$)' `
        -ExactPattern '^Compared 43 complete compiler outputs and 27 user artifacts exactly\.$' `
        -FieldLabel 'bytecode comparator equality summary'
}

function Assert-BytecodeComparisonJson {
    param([Parameter(Mandatory)][string]$Path)

    $document = [System.Text.Json.JsonDocument]::Parse(
        (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop)
    )
    try {
        Assert-Condition (
            $document.RootElement.ValueKind -eq [System.Text.Json.JsonValueKind]::Object
        ) 'Bytecode replay JSON root must be an object'
        $properties = [System.Collections.Generic.Dictionary[string,System.Text.Json.JsonElement]]::new(
            [System.StringComparer]::OrdinalIgnoreCase
        )
        $exactNames = [System.Collections.Generic.HashSet[string]]::new(
            [System.StringComparer]::Ordinal
        )
        foreach ($property in $document.RootElement.EnumerateObject()) {
            Assert-Condition (
                $properties.TryAdd($property.Name, $property.Value.Clone())
            ) "Bytecode replay JSON has a duplicate or case-colliding root property: $($property.Name)"
            $null = $exactNames.Add($property.Name)
        }
        $expectedProperties = @(
            'baseline',
            'candidate',
            'comparedFields',
            'comparisonTool',
            'compilerContractCount',
            'intentionallyDifferentBindings',
            'metadataStrippedOrNormalized',
            'reviewedCaptureTool',
            'schema',
            'userContractCount',
            'verdict'
        )
        Assert-Condition (
            $properties.Count -eq $expectedProperties.Count
        ) "Bytecode replay JSON root property count differs: $($properties.Count)"
        foreach ($property in $expectedProperties) {
            Assert-Condition (
                $properties.ContainsKey($property) -and $exactNames.Contains($property)
            ) "Bytecode replay JSON is missing or case-drifts root property: $property"
        }
        foreach ($objectProperty in @('baseline', 'candidate', 'comparisonTool', 'reviewedCaptureTool')) {
            Assert-Condition (
                $properties[$objectProperty].ValueKind -eq [System.Text.Json.JsonValueKind]::Object
            ) "Bytecode replay JSON property $objectProperty must be an object"
        }
        foreach ($arrayProperty in @('comparedFields', 'intentionallyDifferentBindings')) {
            Assert-Condition (
                $properties[$arrayProperty].ValueKind -eq [System.Text.Json.JsonValueKind]::Array
            ) "Bytecode replay JSON property $arrayProperty must be an array"
        }
        Assert-Condition (
            $properties['metadataStrippedOrNormalized'].ValueKind -eq [System.Text.Json.JsonValueKind]::False
        ) 'Bytecode replay JSON must report metadataStrippedOrNormalized=false'
        foreach ($stringProperty in @('schema', 'verdict')) {
            Assert-Condition (
                $properties[$stringProperty].ValueKind -eq [System.Text.Json.JsonValueKind]::String
            ) "Bytecode replay JSON property $stringProperty must be a string"
        }
        Assert-Condition (
            $properties['schema'].GetString() -ceq 'blockxone-bytecode-comparison-v2'
        ) 'Bytecode replay JSON schema differs'
        Assert-Condition (
            $properties['verdict'].GetString() -ceq 'exact-complete-compiler-output-equality'
        ) 'Bytecode replay JSON verdict differs'
        foreach ($countField in @(
            @{ Name = 'compilerContractCount'; Expected = 43 },
            @{ Name = 'userContractCount'; Expected = 27 }
        )) {
            [int64]$count = 0
            Assert-Condition (
                $properties[$countField.Name].ValueKind -eq [System.Text.Json.JsonValueKind]::Number -and
                $properties[$countField.Name].TryGetInt64([ref]$count) -and
                $count -eq [int64]$countField.Expected
            ) "Bytecode replay JSON $($countField.Name) must be exact integer $($countField.Expected)"
        }
    }
    finally {
        $document.Dispose()
    }
}

function Assert-RunnerTestsOutput {
    param([Parameter(Mandatory)][object]$Result)

    Assert-ExactMatchingLine -Result $Result -Expected 'PHASE0_RUNNER_TESTS_PASS|tool_labels=11|matrix_labels=39|checked_invocations=50|release=NO-GO'
    $lines = @(Get-RawOutputLines -Result $Result)
    $prefixLines = @(
        $lines |
            Where-Object { ([string]$_).StartsWith('PHASE0_RUNNER_TESTS_PASS', [System.StringComparison]::Ordinal) }
    )
    Assert-Condition (
        $prefixLines.Count -eq 1
    ) "$($Result.Label): runner-test final marker prefix must occur exactly once; found=$($prefixLines.Count)"
}

function Assert-ZeroRawOutput {
    param([Parameter(Mandatory)][object]$Result)

    $lines = @(Get-RawOutputLines -Result $Result)
    Assert-Condition (
        $lines.Count -eq 0
    ) "$($Result.Label): expected exactly zero raw output lines; actual_count=$($lines.Count); actual=[$($lines -join '; ')]"
}

function Get-GeneratedOutputInventory {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$WebRoot,
        [Parameter(Mandatory)][string]$ContractsRoot
    )

    return @(
        [pscustomobject]@{ Root = $RepositoryRoot; Relative = 'node_modules'; Destination = 'root-node-modules' }
        [pscustomobject]@{ Root = $RepositoryRoot; Relative = '.npm-cache'; Destination = 'root-npm-cache' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'node_modules'; Destination = 'web-node-modules' }
        [pscustomobject]@{ Root = $WebRoot; Relative = '.next'; Destination = 'web-next' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'coverage'; Destination = 'web-coverage' }
        [pscustomobject]@{ Root = $WebRoot; Relative = '.vite'; Destination = 'web-vite' }
        [pscustomobject]@{ Root = $WebRoot; Relative = '.vitest'; Destination = 'web-vitest' }
        [pscustomobject]@{ Root = $WebRoot; Relative = '.npm-cache'; Destination = 'web-npm-cache' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'out'; Destination = 'web-out' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'build'; Destination = 'web-build' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'dist'; Destination = 'web-dist' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'tsconfig.tsbuildinfo'; Destination = 'web-tsconfig-tsbuildinfo' }
        [pscustomobject]@{ Root = $WebRoot; Relative = 'next-env.d.ts'; Destination = 'web-next-env.d.ts' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = 'node_modules'; Destination = 'contracts-node-modules' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = 'artifacts'; Destination = 'contracts-artifacts' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = '.hardhat-cache'; Destination = 'contracts-hardhat-cache' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = 'cache'; Destination = 'contracts-cache' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = 'typechain-types'; Destination = 'contracts-typechain-types' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = '.npm-cache'; Destination = 'contracts-npm-cache' }
        [pscustomobject]@{ Root = $ContractsRoot; Relative = 'coverage'; Destination = 'contracts-coverage' }
    )
}

function New-ValidatedQuarantineRoot {
    param(
        [string]$TemporaryRoot = [System.IO.Path]::GetTempPath(),
        [string]$Prefix = 'blockxone-phase0-matrix-',
        [scriptblock]$BeforeCreate
    )

    $temporary = Assert-NonReparsePathChain -Path $TemporaryRoot -MustExist -ExpectedType Directory -Label 'OS temporary root'
    $candidate = Join-Path $temporary.FullPath ($Prefix + [Guid]::NewGuid().ToString('N'))
    $candidateState = Assert-NonReparsePathChain -Path $candidate -ExpectedType Any -Label 'generated-output quarantine candidate'
    Assert-Condition (-not $candidateState.Exists) "Quarantine root already exists: $candidate"
    if ($null -ne $BeforeCreate) {
        $null = $BeforeCreate.Invoke($candidate)
    }
    $candidateImmediatelyBeforeCreate = Assert-NonReparsePathChain -Path $candidate -ExpectedType Any -Label 'generated-output quarantine candidate immediately before create'
    Assert-Condition (
        -not $candidateImmediatelyBeforeCreate.Exists
    ) "Quarantine root was created after preflight: $candidate"
    New-Item -ItemType Directory -Path $candidate -ErrorAction Stop | Out-Null
    $created = Assert-NonReparsePathChain -Path $candidate -MustExist -ExpectedType Directory -Label 'generated-output quarantine root'
    $temporaryPrefix = Get-PathPrefix $temporary.FullPath
    Assert-Condition (
        $created.FullPath.StartsWith($temporaryPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) "Generated-output quarantine is outside the OS temporary root: $($created.FullPath)"
    return $created.FullPath
}

function Get-ValidatedGeneratedSource {
    param(
        [Parameter(Mandatory)][object]$InventoryEntry,
        [Parameter(Mandatory)][string]$QuarantineRoot
    )

    $root = Assert-NonReparsePathChain -Path $InventoryEntry.Root -MustExist -ExpectedType Directory -Label 'generated-output component root'
    $rootPrefix = Get-PathPrefix $root.FullPath
    $source = [System.IO.Path]::GetFullPath((Join-Path $root.FullPath $InventoryEntry.Relative))
    Assert-Condition (
        $source.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) "Generated-output source escaped its component root: $source"

    $sourceState = Assert-NonReparsePathChain -Path $source -ExpectedType Any -Label 'generated-output source'
    $quarantine = Assert-NonReparsePathChain -Path $QuarantineRoot -MustExist -ExpectedType Directory -Label 'generated-output quarantine root'
    $quarantinePrefix = Get-PathPrefix $quarantine.FullPath
    $destination = [System.IO.Path]::GetFullPath((Join-Path $quarantine.FullPath $InventoryEntry.Destination))
    Assert-Condition (
        $destination.StartsWith($quarantinePrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) "Generated-output destination escaped quarantine: $destination"
    $destinationState = Assert-NonReparsePathChain -Path $destination -ExpectedType Any -Label 'generated-output destination'
    Assert-Condition (
        -not $destinationState.Exists
    ) "Generated-output quarantine destination already exists: $destination"
    Assert-Condition (
        [System.IO.Path]::GetPathRoot($source) -ceq [System.IO.Path]::GetPathRoot($destination)
    ) "Generated-output source and quarantine are on different volumes: $source -> $destination"

    return [pscustomobject]@{
        Exists = $sourceState.Exists
        Source = $source
        SourceEntry = $sourceState.Entry
        Destination = $destination
        InventoryEntry = $InventoryEntry
    }
}

function Move-ValidatedGeneratedSource {
    param(
        [Parameter(Mandatory)][object]$Validated,
        [scriptblock]$BeforeAtomicMove
    )

    if (-not $Validated.Exists) {
        return $null
    }
    $quarantineRoot = [System.IO.Path]::GetDirectoryName($Validated.Destination)
    $fresh = Get-ValidatedGeneratedSource -InventoryEntry $Validated.InventoryEntry -QuarantineRoot $quarantineRoot
    Assert-Condition $fresh.Exists "Generated-output source disappeared before quarantine: $($Validated.Source)"
    Assert-Condition (
        $fresh.Source.Equals($Validated.Source, [System.StringComparison]::OrdinalIgnoreCase) -and
        $fresh.Destination.Equals($Validated.Destination, [System.StringComparison]::OrdinalIgnoreCase)
    ) 'Generated-output source or destination changed after preflight'
    if ($null -ne $BeforeAtomicMove) {
        $null = $BeforeAtomicMove.Invoke($Validated)
    }
    $sourceNow = Assert-NonReparsePathChain -Path $Validated.Source -MustExist -ExpectedType Any -Label 'generated-output source immediately before move'
    $destinationNow = Assert-NonReparsePathChain -Path $Validated.Destination -ExpectedType Any -Label 'generated-output destination immediately before move'
    Assert-Condition (
        -not $destinationNow.Exists
    ) "Generated-output quarantine destination already exists: $($Validated.Destination)"

    if ($sourceNow.Entry.PSIsContainer) {
        [System.IO.Directory]::Move($Validated.Source, $Validated.Destination)
    }
    else {
        [System.IO.File]::Move($Validated.Source, $Validated.Destination, $false)
    }
    Assert-Condition (-not (Test-Path -LiteralPath $Validated.Source)) "Generated source remains after quarantine: $($Validated.Source)"
    Assert-Condition (Test-Path -LiteralPath $Validated.Destination) "Generated destination is missing after quarantine: $($Validated.Destination)"
    Write-Host "GENERATED_OUTPUT_QUARANTINED=$($Validated.Source) -> $($Validated.Destination)"
    return $Validated.Destination
}

function Invoke-CleanupEntries {
    param(
        [Parameter(Mandatory)][object[]]$Entries,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    $errors = [System.Collections.Generic.List[object]]::new()
    $completed = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $Entries) {
        try {
            $null = $Action.Invoke($entry)
            $completed.Add($entry)
        }
        catch {
            $errors.Add($_)
        }
    }
    return [pscustomobject]@{
        Errors = @($errors)
        Completed = @($completed)
    }
}

function Invoke-GeneratedOutputCleanup {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][string]$WebRoot,
        [Parameter(Mandatory)][string]$ContractsRoot
    )

    $errors = [System.Collections.Generic.List[object]]::new()
    $moves = [System.Collections.Generic.List[string]]::new()
    $quarantineRoot = $null
    try {
        $inventory = @(Get-GeneratedOutputInventory -RepositoryRoot $RepositoryRoot -WebRoot $WebRoot -ContractsRoot $ContractsRoot)
        Assert-Condition ($inventory.Count -eq 20) "Generated-output inventory must contain exactly 20 entries; found $($inventory.Count)"
        Assert-Condition (
            @($inventory | Where-Object { $_.Relative -ceq 'node_modules/.vite' -or $_.Relative -ceq 'node_modules\.vite' }).Count -eq 0
        ) 'Generated-output inventory must not separately move nested node_modules/.vite'
        $destinations = @($inventory | ForEach-Object Destination)
        Assert-Condition (
            @($destinations | Sort-Object -Unique).Count -eq 20
        ) 'Generated-output destinations must be unique'

        $quarantineRoot = New-ValidatedQuarantineRoot
        $validatedEntries = [System.Collections.Generic.List[object]]::new()
        # All source chains and destination ancestors are validated before the
        # first move. This avoids a partial cleanup before an ancestor-junction
        # failure is discovered.
        foreach ($entry in $inventory) {
            $validatedEntries.Add(
                (Get-ValidatedGeneratedSource -InventoryEntry $entry -QuarantineRoot $quarantineRoot)
            )
        }
        $moveResults = Invoke-CleanupEntries -Entries @($validatedEntries) -Action {
            param($validated)
            $destination = Move-ValidatedGeneratedSource -Validated $validated
            if ($null -ne $destination) {
                $moves.Add([string]$destination)
            }
        }
        foreach ($cleanupError in $moveResults.Errors) {
            $errors.Add($cleanupError)
        }
    }
    catch {
        $errors.Add($_)
    }

    if ($null -ne $quarantineRoot) {
        Write-Host "GENERATED_OUTPUT_QUARANTINE=$quarantineRoot"
    }
    return [pscustomobject]@{
        Root = $quarantineRoot
        Moves = @($moves)
        Errors = @($errors)
    }
}

function Get-FailureText {
    param([Parameter(Mandatory)][object]$Failure)

    if ($Failure -is [System.Management.Automation.ErrorRecord]) {
        return $Failure.Exception.Message.Replace("`r", ' ').Replace("`n", ' ')
    }
    if ($Failure -is [System.Exception]) {
        return $Failure.Message.Replace("`r", ' ').Replace("`n", ' ')
    }
    return ([string]$Failure).Replace("`r", ' ').Replace("`n", ' ')
}

function New-AggregatedFailureText {
    param(
        [object]$PrimaryFailure,
        [object[]]$CleanupFailures
    )

    $primaryText = if ($null -eq $PrimaryFailure) { 'none' } else { Get-FailureText $PrimaryFailure }
    $cleanupText = if ($CleanupFailures.Count -eq 0) {
        'none'
    }
    else {
        (@($CleanupFailures | ForEach-Object { Get-FailureText $_ }) -join ' || ')
    }
    return "PHASE0_MATRIX_FAILURE|primary=$primaryText|cleanup=$cleanupText"
}

function New-SelfTestRoot {
    param([Parameter(Mandatory)][string]$Label)

    $tempRoot = Assert-NonReparsePathChain -Path ([System.IO.Path]::GetTempPath()) -MustExist -ExpectedType Directory -Label 'self-test temporary root'
    $candidate = Join-Path $tempRoot.FullPath ("blockxone-runner-selftest-$Label-" + [Guid]::NewGuid().ToString('N'))
    Assert-Condition (-not (Test-Path -LiteralPath $candidate)) "Self-test root exists: $candidate"
    New-Item -ItemType Directory -Path $candidate -ErrorAction Stop | Out-Null
    $null = Assert-NonReparsePathChain -Path $candidate -MustExist -ExpectedType Directory -Label 'self-test root'
    return $candidate
}

function New-SemanticSelfTestResult {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Lines,
        [long]$ElapsedMilliseconds = 6500
    )

    return [pscustomobject]@{
        Label = $Label
        Output = @($Lines)
        Text = $Lines -join [System.Environment]::NewLine
        ElapsedMilliseconds = $ElapsedMilliseconds
    }
}

function Assert-SemanticParserRejects {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][scriptblock]$Parser,
        [Parameter(Mandatory)][string]$Label
    )

    $caught = $null
    try {
        $null = $Parser.Invoke($Result)
    }
    catch {
        $caught = $_
    }
    Assert-Condition ($null -ne $caught) "Semantic parser accepted $Label"
}

function Assert-SemanticRawPreserved {
    param(
        [Parameter(Mandatory)][object]$Result,
        [Parameter(Mandatory)][scriptblock]$Parser,
        [Parameter(Mandatory)][string]$Label,
        [switch]$PassThru
    )

    $textBefore = [string]$Result.Text
    $outputBefore = @($Result.Output | ForEach-Object { [string]$_ })
    $parserOutput = @($Parser.Invoke($Result))
    $outputAfter = @($Result.Output | ForEach-Object { [string]$_ })
    Assert-Condition (
        $Result.Text -ceq $textBefore -and
        $outputAfter.Count -eq $outputBefore.Count
    ) "$Label parser changed raw Text or Output count"
    for ($index = 0; $index -lt $outputBefore.Count; $index++) {
        Assert-Condition (
            $outputAfter[$index] -ceq $outputBefore[$index]
        ) "$Label parser changed raw Output line $index"
    }
    if ($PassThru) {
        return $parserOutput
    }
}

function Assert-NativeEncodingStateEqual {
    param(
        [Parameter(Mandatory)][object]$Actual,
        [Parameter(Mandatory)][object]$Expected,
        [Parameter(Mandatory)][string]$Label
    )

    Assert-Condition (
        $Actual.ConsoleOutputEncoding.Equals($Expected.ConsoleOutputEncoding) -and
        $Expected.ConsoleOutputEncoding.Equals($Actual.ConsoleOutputEncoding) -and
        $Actual.ConsoleOutputFingerprint -ceq $Expected.ConsoleOutputFingerprint
    ) "$Label did not restore exact Console.OutputEncoding"
    Assert-Condition (
        $Actual.ConsoleInputEncoding.Equals($Expected.ConsoleInputEncoding) -and
        $Expected.ConsoleInputEncoding.Equals($Actual.ConsoleInputEncoding) -and
        $Actual.ConsoleInputFingerprint -ceq $Expected.ConsoleInputFingerprint
    ) "$Label changed Console.InputEncoding"
    Assert-Condition (
        $Actual.PowerShellOutputEncoding.Equals($Expected.PowerShellOutputEncoding) -and
        $Expected.PowerShellOutputEncoding.Equals($Actual.PowerShellOutputEncoding) -and
        $Actual.PowerShellOutputFingerprint -ceq $Expected.PowerShellOutputFingerprint
    ) "$Label changed the PowerShell OutputEncoding preference"
}

function Get-LeadingUnicodeScalarEvidence {
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Text
    )

    $codePoint = [System.Char]::ConvertToUtf32($Text, 0)
    $scalarLength = if ($codePoint -gt 0xFFFF) { 2 } else { 1 }
    $scalarText = $Text.Substring(0, $scalarLength)
    $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
    return [pscustomobject]@{
        CodePoint = $codePoint
        CodePointHex = $codePoint.ToString('X4', [System.Globalization.CultureInfo]::InvariantCulture)
        Utf8Hex = [System.Convert]::ToHexString($utf8.GetBytes($scalarText))
    }
}

function Invoke-NativeEncodingSelfTest {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('ibm437', 'utf8')]
        [string]$InitialEncoding,
        [switch]$NativeFailure,
        [switch]$MalformedOutput,
        [switch]$ExercisePostCommandFailures
    )

    $hostState = Get-NativeEncodingBoundaryState
    $initial = if ($InitialEncoding -ceq 'ibm437') {
        [System.Text.Encoding]::GetEncoding(437)
    }
    else {
        [System.Text.UTF8Encoding]::new($false, $true)
    }
    try {
        [System.Console]::OutputEncoding = $initial
        $outerState = Get-NativeEncodingBoundaryState
        $expectedCodePage = if ($InitialEncoding -ceq 'ibm437') { 437 } else { 65001 }
        $expectedWebName = if ($InitialEncoding -ceq 'ibm437') { 'ibm437' } else { 'utf-8' }
        Assert-Condition (
            [System.Console]::OutputEncoding.CodePage -eq $expectedCodePage -and
            [System.Console]::OutputEncoding.WebName -ceq $expectedWebName
        ) "Native encoding self-test could not establish initial $InitialEncoding output encoding"
        Assert-Condition (
            $outerState.ConsoleInputFingerprint -ceq $hostState.ConsoleInputFingerprint -and
            $outerState.PowerShellOutputFingerprint -ceq $hostState.PowerShellOutputFingerprint
        ) "Native encoding self-test setup changed input or PowerShell output encoding"

        if ($MalformedOutput) {
            $malformedFailureRecord = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.encoding.malformed-byte' -Executable $script:NodePath -Arguments @(
                    '-e',
                    'process.stdout.write(Buffer.from([0x80]));process.exit(0)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $malformedFailureRecord = $_
            }
            Assert-NativeEncodingStateEqual `
                -Actual (Get-NativeEncodingBoundaryState) `
                -Expected $outerState `
                -Label 'malformed native byte encoding boundary'
            Assert-Condition (
                $null -ne $malformedFailureRecord -and
                $malformedFailureRecord.Exception.Message.Contains(
                    'NATIVE_COMMAND_UTF8_DECODE_REJECTED|label=selftest.encoding.malformed-byte|line=0|codepoint=FFFD'
                )
            ) 'Malformed native byte was not rejected as an observed U+FFFD decode replacement'
            Write-Output (
                "NATIVE_ENCODING_MALFORMED_REJECTED|initial=$InitialEncoding|codepoint=FFFD|" +
                'outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1'
            )
            return
        }

        if ($NativeFailure) {
            $nativeFailureRecord = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.encoding.native-exit7' -Executable $script:NodePath -Arguments @(
                    '-e',
                    'process.stdout.write("\u2714 NATIVE_UTF8_EXIT7");process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $nativeFailureRecord = $_
            }
            Assert-NativeEncodingStateEqual `
                -Actual (Get-NativeEncodingBoundaryState) `
                -Expected $outerState `
                -Label 'native exit-7 encoding boundary'
            $nativeFailureEvidence = if (
                $null -ne $nativeFailureRecord -and
                $nativeFailureRecord.Exception -is [NativeCommandFailureException] -and
                $nativeFailureRecord.Exception.NativeOutput.Count -ge 1
            ) {
                Get-LeadingUnicodeScalarEvidence `
                    -Text $nativeFailureRecord.Exception.NativeOutput[0]
            }
            else {
                $null
            }
            Assert-Condition (
                $null -ne $nativeFailureRecord -and
                $nativeFailureRecord.Exception -is [NativeCommandFailureException] -and
                $nativeFailureRecord.Exception.NativeExitCode -eq 7 -and
                $nativeFailureRecord.Exception.NativeOutput.Count -ge 1 -and
                $nativeFailureRecord.Exception.NativeOutput[0] -ceq '✔ NATIVE_UTF8_EXIT7' -and
                $null -ne $nativeFailureEvidence -and
                $nativeFailureEvidence.CodePoint -eq 0x2714 -and
                $nativeFailureEvidence.Utf8Hex -ceq 'E29C94'
            ) 'Native encoding self-test did not preserve exact U+2714 output and authoritative exit 7'
            Write-Output (
                "NATIVE_ENCODING_EXIT_AUTHORITY_PASS|initial=$InitialEncoding|exit=7|" +
                "codepoint=$($nativeFailureEvidence.CodePointHex)|utf8=$($nativeFailureEvidence.Utf8Hex)|" +
                'outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1'
            )
            throw $nativeFailureRecord.Exception
        }

        $success = Invoke-NativeChecked -Label "selftest.encoding.$InitialEncoding.success" -Executable $script:NodePath -Arguments @(
            '-e',
            'process.stdout.write("\u2714 NATIVE_UTF8_CHECK");process.exit(0)'
        ) -WorkingDirectory $script:RepositoryRoot
        Assert-Condition (
            $success.Output.Count -eq 1 -and
            $success.Output[0] -ceq '✔ NATIVE_UTF8_CHECK' -and
            $success.Text -ceq '✔ NATIVE_UTF8_CHECK'
        ) "Native $InitialEncoding decoding did not preserve exact U+2714 output"
        $successEvidence = Get-LeadingUnicodeScalarEvidence -Text $success.Output[0]
        Assert-Condition (
            $successEvidence.CodePoint -eq 0x2714 -and
            $successEvidence.Utf8Hex -ceq 'E29C94'
        ) "Native $InitialEncoding decoding did not bind the exact U+2714/E29C94 scalar"
        Assert-NativeEncodingStateEqual `
            -Actual (Get-NativeEncodingBoundaryState) `
            -Expected $outerState `
            -Label "native $InitialEncoding success encoding boundary"

        $semanticFailureCount = 0
        $cleanupFailureCount = 0
        if ($ExercisePostCommandFailures) {
            $semanticResult = Invoke-NativeChecked -Label 'selftest.encoding.semantic' -Executable $script:NodePath -Arguments @(
                '-e',
                'process.stdout.write("\u2714 NATIVE_UTF8_SEMANTIC");process.exit(0)'
            ) -WorkingDirectory $script:RepositoryRoot
            try {
                Assert-ExactOutputLine -Result $semanticResult -Expected 'deliberately-wrong-semantic-expectation'
            }
            catch {
                $semanticFailureCount++
            }
            Assert-Condition ($semanticFailureCount -eq 1) 'Native encoding semantic failure self-test did not fail'
            Assert-NativeEncodingStateEqual `
                -Actual (Get-NativeEncodingBoundaryState) `
                -Expected $outerState `
                -Label 'post-command semantic failure encoding boundary'

            $cleanupCommand = Invoke-NativeChecked -Label 'selftest.encoding.cleanup' -Executable $script:NodePath -Arguments @(
                '-e',
                'process.stdout.write("\u2714 NATIVE_UTF8_CLEANUP");process.exit(0)'
            ) -WorkingDirectory $script:RepositoryRoot
            Assert-Condition (
                $cleanupCommand.Output.Count -eq 1 -and
                $cleanupCommand.Output[0] -ceq '✔ NATIVE_UTF8_CLEANUP'
            ) 'Native cleanup-boundary probe lost exact U+2714 output'
            $cleanup = Invoke-CleanupEntries -Entries @('encoding-cleanup-sentinel') -Action {
                param($entry)
                throw "encoding-cleanup-failure-$entry"
            }
            $cleanupFailureCount = @($cleanup.Errors).Count
            Assert-Condition (
                $cleanupFailureCount -eq 1 -and
                (Get-FailureText $cleanup.Errors[0]).Contains('encoding-cleanup-failure-encoding-cleanup-sentinel')
            ) 'Native encoding cleanup failure self-test did not retain the cleanup diagnostic'
            Assert-NativeEncodingStateEqual `
                -Actual (Get-NativeEncodingBoundaryState) `
                -Expected $outerState `
                -Label 'post-command cleanup failure encoding boundary'
        }

        Write-Output (
            "NATIVE_ENCODING_SELFTEST_PASS|initial=$InitialEncoding|" +
            "codepoint=$($successEvidence.CodePointHex)|utf8=$($successEvidence.Utf8Hex)|" +
            "outer_restore=exact|input_unchanged=1|powershell_output_unchanged=1|" +
            "semantic_failures=$semanticFailureCount|cleanup_failures=$cleanupFailureCount"
        )
    }
    finally {
        Restore-NativeEncodingBoundary -State $hostState
        $restoredHostState = Get-NativeEncodingBoundaryState
        Write-Output (
            "NATIVE_ENCODING_HOST_RESTORE_PASS|" +
            "before_type=$($hostState.ConsoleOutputEncoding.GetType().FullName)|" +
            "after_type=$($restoredHostState.ConsoleOutputEncoding.GetType().FullName)|" +
            'equals_bidirectional=1|semantic_fingerprint=exact|behavior=exact'
        )
    }
}

function Invoke-RunnerSelfTest {
    param([Parameter(Mandatory)][string]$Case)

    switch ($Case) {
        'identity' {
            $tools = Resolve-ToolSet
            $priorGo = Get-ProcessEnvironmentState -Name 'GOTOOLCHAIN'
            try {
                [System.Environment]::SetEnvironmentVariable('GOTOOLCHAIN', 'local', 'Process')
                Invoke-ToolIdentityChecks -Tools $tools
            }
            finally {
                Restore-ProcessEnvironmentState -State $priorGo
            }
        }
        'native-success' {
            $result = Invoke-NativeChecked -Label 'selftest.native.success' -Executable $script:NodePath -Arguments @(
                '-e', "process.stdout.write('SELFTEST_NATIVE_SUCCESS');process.exit(0)"
            ) -WorkingDirectory $script:RepositoryRoot
            Assert-ExactOutputLine -Result $result -Expected 'SELFTEST_NATIVE_SUCCESS'
        }
        'native-failure' {
            $null = Invoke-NativeChecked -Label 'selftest.native.failure' -Executable $script:NodePath -Arguments @(
                '-e', 'process.exit(7)'
            ) -WorkingDirectory $script:RepositoryRoot
            throw 'native-failure self-test unexpectedly returned'
        }
        'native-encoding-ibm437' {
            Invoke-NativeEncodingSelfTest `
                -InitialEncoding 'ibm437' `
                -ExercisePostCommandFailures
        }
        'native-encoding-utf8' {
            Invoke-NativeEncodingSelfTest -InitialEncoding 'utf8'
        }
        'native-encoding-failure' {
            Invoke-NativeEncodingSelfTest -InitialEncoding 'ibm437' -NativeFailure
        }
        'native-encoding-malformed' {
            Invoke-NativeEncodingSelfTest -InitialEncoding 'ibm437' -MalformedOutput
        }
        'missing-resolution' {
            $caught = $null
            try {
                $null = Resolve-ExternalApplication -Name 'blockxone-tool-that-does-not-exist'
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Missing executable resolution did not fail'
        }
        'primary-cleanup' {
            $primary = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.primary.exit7' -Executable $script:NodePath -Arguments @(
                    '-e', 'process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $primary = $_
            }
            $cleanup = Invoke-CleanupEntries -Entries @('cleanup-ok') -Action { param($entry) $null = $entry }
            $failureText = New-AggregatedFailureText -PrimaryFailure $primary -CleanupFailures $cleanup.Errors
            Assert-Condition ($failureText.Contains('label=selftest.primary.exit7|exit=7')) 'Primary label/exit was not preserved'
            Assert-Condition ($failureText.EndsWith('cleanup=none')) 'Successful cleanup was not represented accurately'
        }
        'cleanup-only' {
            $cleanup = Invoke-CleanupEntries -Entries @('cleanup-fail') -Action {
                param($entry)
                throw "cleanup-only-sentinel-$entry"
            }
            $failureText = New-AggregatedFailureText -PrimaryFailure $null -CleanupFailures $cleanup.Errors
            Assert-Condition ($failureText.Contains('primary=none')) 'Cleanup-only failure invented a primary'
            Assert-Condition ($failureText.Contains('cleanup-only-sentinel-cleanup-fail')) 'Cleanup-only diagnostic was lost'
        }
        'primary-cleanup-sentinel' {
            $primary = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.primary.cleanup.exit7' -Executable $script:NodePath -Arguments @(
                    '-e', 'process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $primary = $_
            }
            $script:SelfTestCleanupSentinel = $false
            $cleanup = Invoke-CleanupEntries -Entries @('first', 'sentinel') -Action {
                param($entry)
                if ($entry -ceq 'first') {
                    throw 'cleanup-first-failure'
                }
                $script:SelfTestCleanupSentinel = $true
            }
            $failureText = New-AggregatedFailureText -PrimaryFailure $primary -CleanupFailures $cleanup.Errors
            Assert-Condition $script:SelfTestCleanupSentinel 'Later cleanup sentinel was not attempted'
            Assert-Condition ($failureText.Contains('label=selftest.primary.cleanup.exit7|exit=7')) 'Primary exit 7 was replaced'
            Assert-Condition ($failureText.Contains('cleanup-first-failure')) 'Cleanup diagnostic was not aggregated'
        }
        { $_ -in @('environment-absent', 'environment-valued') } {
            $expectedPresent = $Case -ceq 'environment-valued'
            $prior = Get-ProcessEnvironmentState -Name 'GOTOOLCHAIN'
            Assert-Condition ($prior.Present -eq $expectedPresent) "$Case received an unexpected initial GOTOOLCHAIN presence"
            if ($expectedPresent) {
                Assert-Condition ($prior.Value -ceq 'selftest-prior-value') "$Case received the wrong prior GOTOOLCHAIN value"
            }
            try {
                [System.Environment]::SetEnvironmentVariable('GOTOOLCHAIN', 'local', 'Process')
                Assert-Condition ($env:GOTOOLCHAIN -ceq 'local') "$Case could not set GOTOOLCHAIN=local"
            }
            finally {
                Restore-ProcessEnvironmentState -State $prior
            }
            $after = Get-ProcessEnvironmentState -Name 'GOTOOLCHAIN'
            Assert-Condition (
                (Test-EnvironmentStateEqual -Left $after -Right $prior)
            ) "$Case did not restore the exact prior GOTOOLCHAIN state"
        }
        { $_ -in @('web-environment-absent', 'web-environment-valued') } {
            $expectedPresent = $Case -ceq 'web-environment-valued'
            $apiPrior = Get-ProcessEnvironmentState -Name 'NEXT_PUBLIC_API_URL'
            $originPrior = Get-ProcessEnvironmentState -Name 'SERVER_ACTION_ALLOWED_ORIGINS'
            Assert-Condition (
                $apiPrior.Present -eq $expectedPresent -and
                $originPrior.Present -eq $expectedPresent
            ) "$Case received unexpected web fixture environment presence"
            if ($expectedPresent) {
                Assert-Condition (
                    $apiPrior.Value -ceq 'selftest-api-prior' -and
                    $originPrior.Value -ceq 'selftest-origin-prior'
                ) "$Case received unexpected web fixture environment values"
            }
            try {
                [System.Environment]::SetEnvironmentVariable('NEXT_PUBLIC_API_URL', 'https://api.blockxone.example', 'Process')
                [System.Environment]::SetEnvironmentVariable('SERVER_ACTION_ALLOWED_ORIGINS', 'app.blockxone.example', 'Process')
            }
            finally {
                Restore-ProcessEnvironmentState -State $apiPrior
                Restore-ProcessEnvironmentState -State $originPrior
            }
            $apiAfter = Get-ProcessEnvironmentState -Name 'NEXT_PUBLIC_API_URL'
            $originAfter = Get-ProcessEnvironmentState -Name 'SERVER_ACTION_ALLOWED_ORIGINS'
            Assert-Condition (
                (Test-EnvironmentStateEqual -Left $apiAfter -Right $apiPrior) -and
                (Test-EnvironmentStateEqual -Left $originAfter -Right $originPrior)
            ) "$Case did not restore the exact prior web fixture environment"
        }
        { $_ -in @('path-absent', 'path-valued') } {
            $expectedPresent = $Case -ceq 'path-valued'
            Assert-Condition (
                $script:PriorPath.Present -eq $expectedPresent
            ) "$Case received unexpected prior PATH presence"
            if ($expectedPresent) {
                Assert-Condition (
                    $script:PriorPath.Value -ceq 'selftest-path-prior'
                ) "$Case received the wrong prior PATH value"
            }
            $controlledPath = Get-ProcessEnvironmentState -Name 'PATH'
            Restore-ProcessEnvironmentState -State $script:PriorPath
            $restored = Get-ProcessEnvironmentState -Name 'PATH'
            Assert-Condition (
                (Test-EnvironmentStateEqual -Left $restored -Right $script:PriorPath)
            ) "$Case did not restore the exact prior PATH state"
            Restore-ProcessEnvironmentState -State $controlledPath
        }
        'path-tool-resolution' {
            $resolvedApplications = [ordered]@{}
            $expected = [ordered]@{
                'node.exe' = $script:NodePath
                'npm.cmd' = $script:NpmShimPath
                'go.exe' = $script:GoPath
            }
            foreach ($entry in $expected.GetEnumerator()) {
                $matches = @(
                    Get-Command -Name $entry.Key -CommandType Application -All -ErrorAction Stop
                )
                Assert-Condition ($matches.Count -ge 1) "Controlled PATH did not resolve $($entry.Key)"
                $resolvedFirst = [System.IO.Path]::GetFullPath([string]$matches[0].Source)
                Assert-Condition (
                    $resolvedFirst.Equals([string]$entry.Value, [System.StringComparison]::OrdinalIgnoreCase)
                ) "Controlled PATH resolved $($entry.Key) to $resolvedFirst instead of $($entry.Value)"
                $resolvedApplications[$entry.Key] = $resolvedFirst
            }
            $priorGo = Get-ProcessEnvironmentState -Name 'GOTOOLCHAIN'
            try {
                [System.Environment]::SetEnvironmentVariable('GOTOOLCHAIN', 'local', 'Process')
                $goVersion = Invoke-NativeChecked -Label 'selftest.path.go.version' -Executable $resolvedApplications['go.exe'] -Arguments @(
                    'version'
                ) -WorkingDirectory $script:RepositoryRoot
                Assert-GoVersionIdentity -Result $goVersion
            }
            finally {
                Restore-ProcessEnvironmentState -State $priorGo
            }
        }
        'gosec-semantic-output' {
            $escape = [char]27
            $c1Csi = [char]0x009B
            $coloredLine = "  Issues : ${escape}[1;32m0${escape}[0m"
            $coloredZero = [pscustomobject]@{
                Label = 'selftest.gosec.colored-zero'
                Text = "Summary:`n  Files  : 85`n$coloredLine"
                Output = @('Summary:', '  Files  : 85', $coloredLine)
            }
            $rawTextBefore = [string]$coloredZero.Text
            $rawOutputBefore = @($coloredZero.Output | ForEach-Object { [string]$_ })
            Assert-GosecZeroIssues -Result $coloredZero
            Assert-Condition (
                $coloredZero.Text -ceq $rawTextBefore -and
                (@($coloredZero.Output | ForEach-Object { [string]$_ }) -join "`n") -ceq ($rawOutputBefore -join "`n") -and
                $coloredZero.Text.Contains([string]$escape)
            ) 'gosec parsing mutated or erased raw ANSI output'
            Assert-GosecZeroIssues -Result ([pscustomobject]@{
                Label = 'selftest.gosec.c1-colored-zero'
                Text = "Summary:`n  Issues : ${c1Csi}1;32m0${c1Csi}0m"
            })

            $negativeCases = [ordered]@{
                'colored-nonzero' = "Summary:`n  Issues : ${escape}[1;31m2${escape}[0m"
                'absent' = "Summary:`n  Files : 0`n  Nosec : 0"
                'duplicate' = "Summary:`n  Issues : 0`n  Issues : 0"
                'valid-malformed-duplicate' = "Summary:`n  Issues : 0`n  Issues : zero"
                'malformed' = "Summary:`n  Issues : zero"
                'negative' = "Summary:`n  Issues : -1"
                'decimal' = "Summary:`n  Issues : 0.0"
                'overflow' = "Summary:`n  Issues : 18446744073709551616"
                'trailing-text' = "Summary:`n  Issues : 0 findings"
                'no-issues-prefix' = "Summary:`n  No Issues : 0"
                'embedded-prose' = "Summary:`n  Scanner says Issues : 0 today"
                'misleading-zero' = "Summary:`n  Files : 0`n  Issues : 3`n  Nosec : 0"
            }
            foreach ($entry in $negativeCases.GetEnumerator()) {
                $rejected = $false
                try {
                    Assert-GosecZeroIssues -Result ([pscustomobject]@{
                        Label = "selftest.gosec.$($entry.Key)"
                        Text = [string]$entry.Value
                    })
                }
                catch {
                    $rejected = $true
                }
                Assert-Condition $rejected "gosec semantic parser accepted $($entry.Key)"
            }
            $nativeFailure = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.gosec.native-exit7' -Executable $script:NodePath -Arguments @(
                    '-e',
                    'process.stdout.write("  Issues : \u001b[1;32m0\u001b[0m");process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $nativeFailure = $_
            }
            Assert-Condition (
                $null -ne $nativeFailure -and
                $nativeFailure.Exception -is [NativeCommandFailureException] -and
                $nativeFailure.Exception.NativeExitCode -eq 7
            ) 'ANSI-colored gosec zero output masked native exit 7'
            Write-Output 'GOSEC_SEMANTIC_SELFTEST_PASS|esc_colored_zero=1|c1_colored_zero=1|raw_unchanged=1|negative_cases=12|native_exit7=1'
        }
        'semantic-output' {
            $escape = [char]27
            $c1Csi = [char]0x009B
            $webPreflight = 'Web toolchain preflight passed with Node 22.23.1 and npm 10.9.8.'
            $contractsPreflight = 'Contracts toolchain preflight passed with Node 22.23.1 and npm 10.9.8.'
            $webLintPositive = @(Get-ExpectedWebLintOutputLines)
            $nextBuildPositiveCases = @(
                [pscustomobject]@{
                    Label = 'run63-transcript'
                    Lines = @(
                        $webPreflight,
                        '   Generating static pages (0/45) ...',
                        '   Generating static pages (11/45) ',
                        '   Generating static pages (22/45) ',
                        '   Generating static pages (33/45) ',
                        " ${escape}[32m✓${escape}[0m Generating static pages (45/45)"
                    )
                },
                [pscustomobject]@{
                    Label = 'c1-sgr-transcript'
                    Lines = @(
                        $webPreflight,
                        "${c1Csi}2m   Generating static pages (0/45) ...${c1Csi}0m",
                        "${c1Csi}32m✓${c1Csi}0m Generating static pages (45/45)"
                    )
                }
            )
            $positiveCases = @(
                @{
                    Label = 'planning'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.planning' -Lines @(
                        'PLANNING_VALIDATION=PASS',
                        'MILESTONE=v2.0 Production-Ready Rebuild',
                        'PHASES=12',
                        'PLANS=12',
                        'GSD_ARTIFACT_STATE=partial',
                        'GSD_ARTIFACT_PROGRESS=8%',
                        'REPOSITORY_RESIDUE_MODE=CleanCandidate',
                        'AUTHORITATIVE_PRODUCTION_PROGRESS=0%',
                        'ACTIVE_REQUIREMENTS=89',
                        'CHECKED_REQUIREMENTS=0'
                    )
                    Parser = { param($result) Assert-PlanningValidatorOutput -Result $result }
                },
                @{
                    Label = 'artifact'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.artifact' -Lines @(
                        'Repository artifact policy valid: 489 tracked paths across 27 HEAD-reachable commit(s); modes, prohibited classes and LFS signals are clean.'
                    )
                    Parser = { param($result) Assert-ArtifactValidatorOutput -Result $result }
                },
                @{
                    Label = 'ci'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.ci' -Lines @(
                        'CI policy valid: mandatory checks propagate failure and deployment remains explicitly blocked.'
                    )
                    Parser = { param($result) Assert-CiPolicyOutput -Result $result }
                },
                @{
                    Label = 'compose'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.compose' -Lines @(
                        'Production Compose contract valid: migrate, api, web, worker; 29 required variables fail closed.'
                    )
                    Parser = { param($result) Assert-ComposePolicyOutput -Result $result }
                },
                @{
                    Label = 'lint'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.lint' -Lines @(
                        "${escape}[1;32m0${escape}[0m issues."
                    )
                    Parser = { param($result) Assert-GolangciZeroIssues -Result $result }
                },
                @{
                    Label = 'govuln'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln' -Lines @(
                        "${c1Csi}1;32mNo vulnerabilities found.${c1Csi}0m",
                        'Your code is affected by 0 vulnerabilities.',
                        'This scan also found 8 vulnerabilities in packages you import and 15',
                        'vulnerabilities in modules you require, but your code does not appear to call these vulnerabilities.'
                    )
                    Parser = { param($result) Assert-GovulnReachableZero -Result $result }
                },
                @{
                    Label = 'install'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.install' -Lines @(
                        "${escape}[32madded 524 packages in 19s${escape}[0m"
                    )
                    Parser = { param($result) Assert-NpmInstallSummary -Result $result }
                },
                @{
                    Label = 'tap'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.tap' -Lines @(
                        'TAP version 13',
                        'ok 1 - one',
                        'ok 2 - two',
                        'ok 3 - three',
                        'ok 4 - four',
                        '1..4',
                        '# tests 4',
                        '# suites 0',
                        '# pass 4',
                        '# fail 0',
                        '# cancelled 0',
                        '# skipped 0',
                        "${c1Csi}32m# todo 0${c1Csi}0m"
                    )
                    Parser = { param($result) Assert-TapSummary -Result $result -ExpectedTests 4 }
                },
                @{
                    Label = 'vitest'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.vitest' -Lines @(
                        $webPreflight,
                        'BLOCKXONE_HERMETIC_CACHE_CREATED=C:\Temp\blockxone-vitest-exact',
                        "${escape}[2m Test Files ${escape}[22m ${escape}[32m3 passed${escape}[0m (3)",
                        "${c1Csi}2m      Tests ${c1Csi}22m ${c1Csi}32m92 passed${c1Csi}0m (92)",
                        'BLOCKXONE_HERMETIC_CACHE_CLEANED=C:\Temp\blockxone-vitest-exact'
                    )
                    Parser = { param($result) Assert-VitestSummary -Result $result -ExpectedTests 92 -ExpectedFiles 3 }
                },
                @{
                    Label = 'web-lint'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.web-lint' -Lines $webLintPositive
                    Parser = { param($result) Assert-WebLintSummary -Result $result }
                },
                @{
                    Label = 'audit'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.audit' -Lines @(
                        "${c1Csi}32mfound 0 vulnerabilities${c1Csi}0m"
                    )
                    Parser = { param($result) Assert-NpmAuditZero -Result $result }
                },
                @{
                    Label = 'next-build'
                    Result = New-SemanticSelfTestResult `
                        -Label 'selftest.semantic.next-build' `
                        -Lines $nextBuildPositiveCases[0].Lines
                    Parser = { param($result) Assert-NextBuildSummary -Result $result }
                },
                @{
                    Label = 'containment'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.containment' -Lines @(
                        $webPreflight,
                        'Production containment probe passed; captured exact-tree cleanup completed and its loopback port stably refused connections.'
                    )
                    Parser = { param($result) Assert-ProductionContainmentOutput -Result $result }
                },
                @{
                    Label = 'hardhat-compile'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.hardhat-compile' -Lines @(
                        $contractsPreflight,
                        "${escape}[1mCompiled 27 Solidity files with solc 0.8.20${escape}[0m (evm target: shanghai)"
                    )
                    Parser = { param($result) Assert-HardhatCompileSummary -Result $result }
                },
                @{
                    Label = 'hardhat-tests'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.hardhat-tests' -Lines @(
                        $contractsPreflight,
                        '  59 passing (2s)',
                        "${c1Csi}32m59 passing${c1Csi}0m (59 nodejs)"
                    )
                    Parser = { param($result) Assert-HardhatTestSummary -Result $result -ExpectedTests 59 }
                },
                @{
                    Label = 'bytecode'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.bytecode' -Lines @(
                        'Compared 43 complete compiler outputs and 27 user artifacts exactly.'
                    )
                    Parser = { param($result) Assert-BytecodeComparatorOutput -Result $result }
                },
                @{
                    Label = 'runner'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.runner' -Lines @(
                        'prior evidence line',
                        'PHASE0_RUNNER_TESTS_PASS|tool_labels=11|matrix_labels=39|checked_invocations=50|release=NO-GO'
                    )
                    Parser = { param($result) Assert-RunnerTestsOutput -Result $result }
                },
                @{
                    Label = 'zero-output'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.zero-output' -Lines @()
                    Parser = { param($result) Assert-ZeroRawOutput -Result $result }
                }
            )
            foreach ($positive in $positiveCases) {
                Assert-SemanticRawPreserved `
                    -Result $positive.Result `
                    -Parser $positive.Parser `
                    -Label $positive.Label
            }
            foreach ($nextPositive in @($nextBuildPositiveCases | Select-Object -Skip 1)) {
                Assert-SemanticRawPreserved `
                    -Result (New-SemanticSelfTestResult -Label "selftest.semantic.next-$($nextPositive.Label)" -Lines $nextPositive.Lines) `
                    -Parser { param($result) Assert-NextBuildSummary -Result $result } `
                    -Label "next-build $($nextPositive.Label)"
            }

            $webLintParser = { param($result) Assert-WebLintSummary -Result $result }
            $webLintBase = @(Get-ExpectedWebLintOutputLines)
            $webLintWarning = [string[]]$webLintBase.Clone()
            $webLintWarning[-1] = 'No ESLint errors but 1 warning'
            $webLintError = [string[]]$webLintBase.Clone()
            $webLintError[-1] = '1 ESLint error'
            $webLintMalformed = [string[]]$webLintBase.Clone()
            $webLintMalformed[-1] = 'No ESLint warnings or errors'
            $webLintMojibake = [string[]]$webLintBase.Clone()
            $webLintMojibake[-1] = 'Γ£ö No ESLint warnings or errors'
            $webLintPreambleSpoof = [string[]]$webLintBase.Clone()
            $webLintPreambleSpoof[1] = '> @blockxone/web@1.0.0 lint'
            $webLintControl = [string[]]$webLintBase.Clone()
            $webLintControl[-1] = "${escape}]0;title$([char]7)✔ No ESLint warnings or errors"
            $webLintSgr = [string[]]$webLintBase.Clone()
            $webLintSgr[-1] = "${escape}[32m✔ No ESLint warnings or errors${escape}[0m"
            $webLintMissingPreamble = @($webLintBase[0]) + @($webLintBase[2..18])
            $webLintMissingBlank = @($webLintBase[0..3]) + @($webLintBase[5..18])
            foreach ($webLintNegative in @(
                [pscustomobject]@{ Label = 'warning'; Lines = $webLintWarning },
                [pscustomobject]@{ Label = 'error'; Lines = $webLintError },
                [pscustomobject]@{ Label = 'malformed'; Lines = $webLintMalformed },
                [pscustomobject]@{ Label = 'mojibake'; Lines = $webLintMojibake },
                [pscustomobject]@{ Label = 'duplicate'; Lines = @($webLintBase + $webLintBase[-1]) },
                [pscustomobject]@{ Label = 'extra'; Lines = @($webLintBase + 'unexpected lint output') },
                [pscustomobject]@{ Label = 'extra-blank'; Lines = @($webLintBase + '') },
                [pscustomobject]@{ Label = 'control'; Lines = $webLintControl },
                [pscustomobject]@{ Label = 'sgr-control'; Lines = $webLintSgr },
                [pscustomobject]@{ Label = 'preamble-spoof'; Lines = $webLintPreambleSpoof },
                [pscustomobject]@{ Label = 'missing-preamble'; Lines = $webLintMissingPreamble },
                [pscustomobject]@{ Label = 'missing-blank'; Lines = $webLintMissingBlank }
            )) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label "selftest.semantic.web-lint-$($webLintNegative.Label)" -Lines $webLintNegative.Lines) `
                    -Parser $webLintParser `
                    -Label "web lint $($webLintNegative.Label)"
            }

            $auditParser = { param($result) Assert-NpmAuditZero -Result $result }
            foreach ($invalid in @(
                @('found 1 vulnerabilities'),
                @('found 0 vulnerabilities', 'found 0 vulnerabilities'),
                @('found 0 vulnerabilities', 'found 2 vulnerabilities'),
                @('found zero vulnerabilities'),
                @('prefix found 0 vulnerabilities'),
                @('found +0 vulnerabilities'),
                @('found -0 vulnerabilities'),
                @('found 0.0 vulnerabilities'),
                @('found 0,0 vulnerabilities'),
                @('found 0e0 vulnerabilities'),
                @('found ٠ vulnerabilities'),
                @('found 18446744073709551616 vulnerabilities'),
                @("${escape}]0;title${([char]7)}found 0 vulnerabilities"),
                @("${escape}[2Jfound 0 vulnerabilities")
            )) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.audit-negative' -Lines $invalid) `
                    -Parser $auditParser `
                    -Label "npm-audit negative [$($invalid -join '; ')]"
            }

            $tapParser = { param($result) Assert-TapSummary -Result $result -ExpectedTests 4 }
            $tapBase = @(
                '1..4', '# tests 4', '# suites 0', '# pass 4',
                '# fail 0', '# cancelled 0', '# skipped 0', '# todo 0'
            )
            foreach ($replacement in @(
                '# pass 3',
                '# fail 1',
                '# cancelled 1',
                '# skipped 1',
                '# todo 1',
                '# tests ٤',
                '# tests 18446744073709551616'
            )) {
                $mutated = @($tapBase | ForEach-Object { if ($_ -ceq '# tests 4' -and $replacement.StartsWith('# tests')) { $replacement } elseif ($_ -ceq '# pass 4' -and $replacement.StartsWith('# pass')) { $replacement } elseif ($_ -ceq '# fail 0' -and $replacement.StartsWith('# fail')) { $replacement } elseif ($_ -ceq '# cancelled 0' -and $replacement.StartsWith('# cancelled')) { $replacement } elseif ($_ -ceq '# skipped 0' -and $replacement.StartsWith('# skipped')) { $replacement } elseif ($_ -ceq '# todo 0' -and $replacement.StartsWith('# todo')) { $replacement } else { $_ } })
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.tap-negative' -Lines $mutated) `
                    -Parser $tapParser `
                    -Label "TAP adverse $replacement"
            }
            Assert-SemanticParserRejects `
                -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.tap-duplicate' -Lines @($tapBase + '# pass 4')) `
                -Parser $tapParser `
                -Label 'TAP duplicate pass'

            $vitestParser = { param($result) Assert-VitestSummary -Result $result -ExpectedTests 92 -ExpectedFiles 3 }
            $vitestPrefix = @(
                $webPreflight,
                'BLOCKXONE_HERMETIC_CACHE_CREATED=C:\Temp\cache'
            )
            $vitestSuffix = @('BLOCKXONE_HERMETIC_CACHE_CLEANED=C:\Temp\cache')
            foreach ($summaries in @(
                @('Test Files 3 passed (3)', 'Tests 91 passed (92)'),
                @('Test Files 3 passed (3)', 'Tests 92 passed (93)'),
                @('Test Files 4 passed (4)', 'Tests 92 passed (92)'),
                @('Test Files 3 passed (3)', 'Tests 92 passed (92)', 'Tests 92 passed (92)'),
                @('Test Files 3 passed (3)', 'Tests 92 passed (92)', 'Tests 1 failed (93)'),
                @('Test Files 3 passed (3)', 'Tests 92 passed | 1 skipped (93)'),
                @('Test Files 3 passed (3)', 'Tests 18446744073709551616 passed (18446744073709551616)'),
                @('Test Files 3 passed (3)', "${escape}[2JTests 92 passed (92)")
            )) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.vitest-negative' -Lines @($vitestPrefix + $summaries + $vitestSuffix)) `
                    -Parser $vitestParser `
                    -Label "Vitest negative [$($summaries -join '; ')]"
            }
            Assert-SemanticParserRejects `
                -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.vitest-cache-mismatch' -Lines @(
                    $webPreflight,
                    'BLOCKXONE_HERMETIC_CACHE_CREATED=C:\Temp\one',
                    'Test Files 3 passed (3)',
                    'Tests 92 passed (92)',
                    'BLOCKXONE_HERMETIC_CACHE_CLEANED=C:\Temp\two'
                )) `
                -Parser $vitestParser `
                -Label 'Vitest cache path mismatch'

            $nextParser = { param($result) Assert-NextBuildSummary -Result $result }
            $nextNegativeCases = @(
                [pscustomobject]@{ Label = 'missing-start'; Lines = @('✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'start-no-ellipsis'; Lines = @('Generating static pages (0/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'checked-start'; Lines = @('✓ Generating static pages (0/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'duplicate-start'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (0/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'nonzero-ellipsis'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (11/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'checked-intermediate'; Lines = @('Generating static pages (0/45) ...', '✓ Generating static pages (11/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'duplicate-intermediate'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (11/45)', 'Generating static pages (11/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'decreasing'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (30/45)', 'Generating static pages (20/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'unchecked-final'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'missing-final'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (33/45)') },
                [pscustomobject]@{ Label = 'duplicate-final'; Lines = @('Generating static pages (0/45) ...', '✓ Generating static pages (45/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'nonlast-final'; Lines = @('Generating static pages (0/45) ...', '✓ Generating static pages (45/45)', 'Generating static pages (44/45)') },
                [pscustomobject]@{ Label = 'wrong-start-total'; Lines = @('Generating static pages (0/46) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'wrong-intermediate-total'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (11/46)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'wrong-final-total'; Lines = @('Generating static pages (0/45) ...', '✓ Generating static pages (45/46)') },
                [pscustomobject]@{ Label = 'range'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (46/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'overflow'; Lines = @('Generating static pages (0/45) ...', 'Generating static pages (18446744073709551616/45)', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'signed'; Lines = @('Generating static pages (+0/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'unicode-digit'; Lines = @('Generating static pages (٠/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'leading-zero-done'; Lines = @('Generating static pages (00/45) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'leading-zero-total'; Lines = @('Generating static pages (0/045) ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'missing-parentheses'; Lines = @('Generating static pages 0/45 ...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'two-dot-suffix'; Lines = @('Generating static pages (0/45) ..', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'four-dot-suffix'; Lines = @('Generating static pages (0/45) ....', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'unicode-ellipsis'; Lines = @('Generating static pages (0/45) …', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'suffix-trailing-text'; Lines = @('Generating static pages (0/45) ... waiting', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'attached-ellipsis'; Lines = @('Generating static pages (0/45)...', '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'final-suffix'; Lines = @('Generating static pages (0/45) ...', '✓ Generating static pages (45/45) ...') },
                [pscustomobject]@{ Label = 'non-sgr-control'; Lines = @("${escape}[2JGenerating static pages (0/45) ...", '✓ Generating static pages (45/45)') },
                [pscustomobject]@{ Label = 'spoof-with-valid'; Lines = @('Generating static pages (0/45) ...', 'prefix Generating static pages (11/45)', '✓ Generating static pages (45/45)') }
            )
            foreach ($nextNegative in $nextNegativeCases) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label "selftest.semantic.next-$($nextNegative.Label)" -Lines @(@($webPreflight) + $nextNegative.Lines)) `
                    -Parser $nextParser `
                    -Label "Next progress $($nextNegative.Label)"
            }

            $compileParser = { param($result) Assert-HardhatCompileSummary -Result $result }
            foreach ($summary in @(
                'Compiled 26 Solidity files with solc 0.8.20 (evm target: shanghai)',
                'Compiled 27 Solidity files with solc 0.8.21 (evm target: shanghai)',
                'Compiled 27 Solidity files with solc 0.8.20 (evm target: paris)',
                'Compiled 18446744073709551616 Solidity files with solc 0.8.20 (evm target: shanghai)'
            )) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.compile-negative' -Lines @($contractsPreflight, $summary)) `
                    -Parser $compileParser `
                    -Label "Hardhat compile negative $summary"
            }

            $hardhatParser = { param($result) Assert-HardhatTestSummary -Result $result -ExpectedTests 59 }
            foreach ($summaries in @(
                @('58 passing (58 nodejs)'),
                @('59 passing (58 nodejs)'),
                @('59 passing (59 nodejs)', '59 passing (59 nodejs)'),
                @('59 passing (59 nodejs)', '1 pending'),
                @('59 passing (59 nodejs)', '1 failing (1 nodejs)'),
                @('59 passing (59 nodejs)', '1 skipped (1 nodejs)'),
                @('59 passing (59 nodejs)', '1 todo (1 nodejs)'),
                @('18446744073709551616 passing (18446744073709551616 nodejs)'),
                @('59 passing (59 nodejs)', '٥٩ passing (٥٩ nodejs)'),
                @('59 passing (59 nodejs)', '+59 passing (+59 nodejs)'),
                @('59 passing (59 nodejs)', 'zero passing (zero nodejs)'),
                @('59 passing (59 nodejs)', '59 passing (nodejs)'),
                @('59 passing (59 nodejs)', '١ failing'),
                @('59 passing (59 nodejs)', '-1 pending')
            )) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label 'selftest.semantic.hardhat-negative' -Lines @(@($contractsPreflight) + $summaries)) `
                    -Parser $hardhatParser `
                    -Label "Hardhat test negative [$($summaries -join '; ')]"
            }

            foreach ($negative in @(
                @{
                    Label = 'planning duplicate'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.planning-duplicate' -Lines @(
                        'PLANNING_VALIDATION=PASS', 'MILESTONE=v2.0 Production-Ready Rebuild',
                        'PHASES=12', 'PHASES=12', 'PLANS=12', 'GSD_ARTIFACT_STATE=partial',
                        'GSD_ARTIFACT_PROGRESS=8%', 'REPOSITORY_RESIDUE_MODE=CleanCandidate',
                        'AUTHORITATIVE_PRODUCTION_PROGRESS=0%', 'ACTIVE_REQUIREMENTS=89',
                        'CHECKED_REQUIREMENTS=0'
                    )
                    Parser = { param($result) Assert-PlanningValidatorOutput -Result $result }
                },
                @{
                    Label = 'planning trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.planning-blank' -Lines @(
                        'PLANNING_VALIDATION=PASS', 'MILESTONE=v2.0 Production-Ready Rebuild',
                        'PHASES=12', 'PLANS=12', 'GSD_ARTIFACT_STATE=partial',
                        'GSD_ARTIFACT_PROGRESS=8%', 'REPOSITORY_RESIDUE_MODE=CleanCandidate',
                        'AUTHORITATIVE_PRODUCTION_PROGRESS=0%', 'ACTIVE_REQUIREMENTS=89',
                        'CHECKED_REQUIREMENTS=0', ''
                    )
                    Parser = { param($result) Assert-PlanningValidatorOutput -Result $result }
                },
                @{
                    Label = 'lint conflict'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.lint-conflict' -Lines @('0 issues.', '2 issues.')
                    Parser = { param($result) Assert-GolangciZeroIssues -Result $result }
                },
                @{
                    Label = 'lint malformed companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.lint-malformed' -Lines @('0 issues.', 'zero issues.')
                    Parser = { param($result) Assert-GolangciZeroIssues -Result $result }
                },
                @{
                    Label = 'lint Unicode companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.lint-unicode' -Lines @('0 issues.', '٠ issues.')
                    Parser = { param($result) Assert-GolangciZeroIssues -Result $result }
                },
                @{
                    Label = 'lint signed companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.lint-signed' -Lines @('0 issues.', '+0 issues.')
                    Parser = { param($result) Assert-GolangciZeroIssues -Result $result }
                },
                @{
                    Label = 'govuln conflict'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln-conflict' -Lines @(
                        'No vulnerabilities found.',
                        'Your code is affected by 2 vulnerabilities.'
                    )
                    Parser = { param($result) Assert-GovulnReachableZero -Result $result }
                },
                @{
                    Label = 'govuln malformed marker companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln-malformed' -Lines @(
                        'No vulnerabilities found.',
                        'Zero vulnerabilities found.',
                        'Your code is affected by 0 vulnerabilities.'
                    )
                    Parser = { param($result) Assert-GovulnReachableZero -Result $result }
                },
                @{
                    Label = 'govuln Unicode marker companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln-unicode' -Lines @(
                        'No vulnerabilities found.',
                        '٠ vulnerabilities found.',
                        'Your code is affected by 0 vulnerabilities.'
                    )
                    Parser = { param($result) Assert-GovulnReachableZero -Result $result }
                },
                @{
                    Label = 'govuln punctuation companion'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln-punctuation' -Lines @(
                        'No vulnerabilities found.',
                        'No vulnerabilities found',
                        'Your code is affected by 0 vulnerabilities.'
                    )
                    Parser = { param($result) Assert-GovulnReachableZero -Result $result }
                },
                @{
                    Label = 'install zero'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.install-zero' -Lines @('added 0 packages in 1s')
                    Parser = { param($result) Assert-NpmInstallSummary -Result $result }
                },
                @{
                    Label = 'bytecode duplicate'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.bytecode-duplicate' -Lines @(
                        'Compared 43 complete compiler outputs and 27 user artifacts exactly.',
                        'Compared 43 complete compiler outputs and 27 user artifacts exactly.'
                    )
                    Parser = { param($result) Assert-BytecodeComparatorOutput -Result $result }
                },
                @{
                    Label = 'bytecode trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.bytecode-blank' -Lines @(
                        'Compared 43 complete compiler outputs and 27 user artifacts exactly.',
                        ''
                    )
                    Parser = { param($result) Assert-BytecodeComparatorOutput -Result $result }
                },
                @{
                    Label = 'artifact trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.artifact-blank' -Lines @(
                        'Repository artifact policy valid: 489 tracked paths across 27 HEAD-reachable commit(s); modes, prohibited classes and LFS signals are clean.',
                        ''
                    )
                    Parser = { param($result) Assert-ArtifactValidatorOutput -Result $result }
                },
                @{
                    Label = 'runner conflict'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.runner-conflict' -Lines @(
                        'PHASE0_RUNNER_TESTS_PASS|tool_labels=11|matrix_labels=39|checked_invocations=50|release=NO-GO',
                        'PHASE0_RUNNER_TESTS_PASS|tool_labels=11|matrix_labels=39|checked_invocations=49|release=NO-GO'
                    )
                    Parser = { param($result) Assert-RunnerTestsOutput -Result $result }
                },
                @{
                    Label = 'runner trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.runner-blank' -Lines @(
                        'prior evidence line',
                        'PHASE0_RUNNER_TESTS_PASS|tool_labels=11|matrix_labels=39|checked_invocations=50|release=NO-GO',
                        ''
                    )
                    Parser = { param($result) Assert-RunnerTestsOutput -Result $result }
                },
                @{
                    Label = 'exact line trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.exact-trailing-blank' -Lines @(
                        'CI policy valid: mandatory checks propagate failure and deployment remains explicitly blocked.',
                        ''
                    )
                    Parser = { param($result) Assert-CiPolicyOutput -Result $result }
                },
                @{
                    Label = 'exact line leading blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.exact-leading-blank' -Lines @(
                        '',
                        'CI policy valid: mandatory checks propagate failure and deployment remains explicitly blocked.'
                    )
                    Parser = { param($result) Assert-CiPolicyOutput -Result $result }
                },
                @{
                    Label = 'actionlint identity trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.actionlint-blank' -Lines @(
                        'v1.7.12',
                        'installed by building from source',
                        'built with go1.26.5 compiler for windows/amd64',
                        ''
                    )
                    Parser = { param($result) Assert-ActionlintIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-identity-blank' -Lines @(
                        'golangci-lint has version 2.12.2 built with go1.26.5 from (test) on (test)',
                        ''
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity SGR control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-sgr' -Lines @(
                        "golangci-lint has version 2.12.2 built with go1.26.5 from (${escape}[31munknown${escape}[0m) on (unknown)"
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity OSC control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-osc' -Lines @(
                        "golangci-lint has version 2.12.2 built with go1.26.5 from (${escape}]0;title$([char]7)unknown) on (unknown)"
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity C1 control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-c1' -Lines @(
                        "golangci-lint has version 2.12.2 built with go1.26.5 from (${c1Csi}31munknown) on (unknown)"
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity embedded newline'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-newline' -Lines @(
                        "golangci-lint has version 2.12.2 built with go1.26.5 from (unknown`nmodified) on (unknown)"
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'golangci identity conflicting line'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.golangci-conflict' -Lines @(
                        'golangci-lint has version 2.12.2 built with go1.26.5 from (unknown) on (unknown)',
                        'golangci-lint has version 2.12.2 built with go1.26.5 from (other) on (other)'
                    )
                    Parser = { param($result) Assert-GolangciIdentity -Result $result }
                },
                @{
                    Label = 'gosec identity trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.gosec-identity-blank' -Lines @(
                        "`tpath`tgithub.com/securego/gosec/v2/cmd/gosec",
                        "`tmod`tgithub.com/securego/gosec/v2`tv2.25.0`th1:8fN1/16qO0aA3ktgU9nDW5PdrCPd4vgpgaPM8ZE+aEA=",
                        ''
                    )
                    Parser = { param($result) Assert-GosecModuleIdentity -Result $result }
                },
                @{
                    Label = 'gosec identity SGR control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.gosec-sgr' -Lines @(
                        "`tpath`tgithub.com/securego/gosec/v2/cmd/gosec",
                        "`tmod`tgithub.com/securego/gosec/v2`tv2.25.0`th1:8fN1/16qO0aA3ktgU9nDW5PdrCPd4vgpgaPM8ZE+aEA=",
                        "`tdep`tmodule`t${escape}[31mv1.0.0${escape}[0m"
                    )
                    Parser = { param($result) Assert-GosecModuleIdentity -Result $result }
                },
                @{
                    Label = 'gosec identity OSC control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.gosec-osc' -Lines @(
                        "`tpath`tgithub.com/securego/gosec/v2/cmd/gosec",
                        "`tmod`tgithub.com/securego/gosec/v2`tv2.25.0`th1:8fN1/16qO0aA3ktgU9nDW5PdrCPd4vgpgaPM8ZE+aEA=",
                        "`tdep`tmodule`t${escape}]0;title$([char]7)v1.0.0"
                    )
                    Parser = { param($result) Assert-GosecModuleIdentity -Result $result }
                },
                @{
                    Label = 'gosec identity C1 control'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.gosec-c1' -Lines @(
                        "`tpath`tgithub.com/securego/gosec/v2/cmd/gosec",
                        "`tmod`tgithub.com/securego/gosec/v2`tv2.25.0`th1:8fN1/16qO0aA3ktgU9nDW5PdrCPd4vgpgaPM8ZE+aEA=",
                        "`tdep`tmodule`t${c1Csi}31mv1.0.0"
                    )
                    Parser = { param($result) Assert-GosecModuleIdentity -Result $result }
                },
                @{
                    Label = 'govuln identity extra blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.govuln-identity-blank' -Lines @(
                        'Go: go1.26.5',
                        'Scanner: govulncheck@v1.6.0',
                        'DB: https://vuln.go.dev',
                        'DB updated: 2026-07-23 18:46:07 +0000 UTC',
                        '',
                        ''
                    )
                    Parser = { param($result) Assert-GovulncheckIdentity -Result $result }
                },
                @{
                    Label = 'Docker identity trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.docker-blank' -Lines @(
                        'Docker version 28.5.1, build e180ab8',
                        ''
                    )
                    Parser = { param($result) Assert-DockerIdentity -Result $result }
                },
                @{
                    Label = 'Git identity trailing blank'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.git-blank' -Lines @(
                        'git version 2.52.0.windows.1',
                        ''
                    )
                    Parser = { param($result) Assert-GitIdentity -Result $result }
                },
                @{
                    Label = 'Docker identity numeric overflow'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.docker-overflow' -Lines @(
                        'Docker version 18446744073709551616.1.3, build f52814d'
                    )
                    Parser = { param($result) Assert-DockerIdentity -Result $result }
                },
                @{
                    Label = 'Git identity numeric overflow'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.git-overflow' -Lines @(
                        'git version 18446744073709551616.53.0.windows.2'
                    )
                    Parser = { param($result) Assert-GitIdentity -Result $result }
                },
                @{
                    Label = 'Docker identity Unicode numeric component'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.docker-unicode' -Lines @(
                        'Docker version ٢٩.1.3, build f52814d'
                    )
                    Parser = { param($result) Assert-DockerIdentity -Result $result }
                },
                @{
                    Label = 'Git identity signed numeric component'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.git-signed' -Lines @(
                        'git version +2.53.0.windows.2'
                    )
                    Parser = { param($result) Assert-GitIdentity -Result $result }
                },
                @{
                    Label = 'zero empty line'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.zero-empty' -Lines @('')
                    Parser = { param($result) Assert-ZeroRawOutput -Result $result }
                },
                @{
                    Label = 'zero multiple blank lines'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.zero-multiple-blank' -Lines @('', '')
                    Parser = { param($result) Assert-ZeroRawOutput -Result $result }
                },
                @{
                    Label = 'zero whitespace'
                    Result = New-SemanticSelfTestResult -Label 'selftest.semantic.zero-whitespace' -Lines @(' ')
                    Parser = { param($result) Assert-ZeroRawOutput -Result $result }
                }
            )) {
                Assert-SemanticParserRejects -Result $negative.Result -Parser $negative.Parser -Label $negative.Label
            }

            $nativeFailure = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.semantic.native-exit7' -Executable $script:NodePath -Arguments @(
                    '-e',
                    'console.log("Web toolchain preflight passed with Node 22.23.1 and npm 10.9.8.");console.log("   Generating static pages (0/45) ...");console.log(" ✓ Generating static pages (45/45)");process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $nativeFailure = $_
            }
            Assert-Condition (
                $null -ne $nativeFailure -and
                $nativeFailure.Exception -is [NativeCommandFailureException] -and
                $nativeFailure.Exception.NativeExitCode -eq 7
            ) 'Valid-looking semantic output masked native exit 7'
            Write-Output "NEXT_BUILD_SEMANTIC_SELFTEST_PASS|positives=$($nextBuildPositiveCases.Count)|negatives=$($nextNegativeCases.Count)|denominator=45|range=bounded|monotonic=1|final=exact-one-last|ansi_sgr=1|native_exit7=1|raw_preserved=1"
            Write-Output "SEMANTIC_OUTPUT_SELFTEST_PASS|families=$($positiveCases.Count)|numeric_negatives=14|tap_negatives=8|vitest_negatives=9|next_positives=$($nextBuildPositiveCases.Count)|next_negatives=$($nextNegativeCases.Count)|web_lint_negatives=12|compile_negatives=4|hardhat_negatives=14|companion_negatives=6|raw_line_negatives=9|identity_blank_negatives=6|identity_version_negatives=4|identity_raw_negatives=8|native_exit7=1|raw_preserved=1"
        }
        'go-discovery-output' {
            $testedPackages = @(
                'blockxone/cmd/api',
                'blockxone/cmd/seed',
                'blockxone/internal/auth',
                'blockxone/internal/chain',
                'blockxone/internal/config',
                'blockxone/internal/ethsig',
                'blockxone/internal/middleware',
                'blockxone/internal/migrate',
                'blockxone/internal/monitoring',
                'blockxone/internal/payments',
                'blockxone/internal/policy',
                'blockxone/internal/releasepolicy'
            )
            $noTestPackages = @(
                'blockxone/cmd/migrate',
                'blockxone/cmd/worker',
                'blockxone/internal/app',
                'blockxone/internal/audit',
                'blockxone/internal/chainlog',
                'blockxone/internal/custody',
                'blockxone/internal/db',
                'blockxone/internal/events',
                'blockxone/internal/examples',
                'blockxone/internal/kyc',
                'blockxone/internal/logging',
                'blockxone/internal/rbac',
                'blockxone/scripts'
            )
            $lines = [System.Collections.Generic.List[string]]::new()
            for ($index = 0; $index -lt 357; $index++) {
                $event = [ordered]@{
                    Time = '2026-07-24T00:00:00Z'
                    Action = 'pass'
                    Package = $testedPackages[$index % $testedPackages.Count]
                    Test = ('TestSemantic{0:D3}' -f $index)
                    Elapsed = 0.001
                }
                $lines.Add(($event | ConvertTo-Json -Compress -Depth 3))
            }
            foreach ($package in $testedPackages) {
                $lines.Add((([ordered]@{
                    Time = '2026-07-24T00:00:01Z'
                    Action = 'pass'
                    Package = $package
                    Elapsed = 0.001
                }) | ConvertTo-Json -Compress -Depth 3))
            }
            $testedOnlyLineCount = $lines.Count
            $syntheticNoTestElapsed = [ordered]@{
                'blockxone/cmd/migrate' = '0.001'
                'blockxone/cmd/worker' = '0.0'
                'blockxone/internal/app' = '0'
                'blockxone/internal/audit' = '0'
                'blockxone/internal/chainlog' = '0.001'
                'blockxone/internal/custody' = '0'
                'blockxone/internal/db' = '0'
                'blockxone/internal/events' = '0'
                'blockxone/internal/examples' = '0'
                'blockxone/internal/kyc' = '0'
                'blockxone/internal/logging' = '0'
                'blockxone/internal/rbac' = '0'
                'blockxone/scripts' = '0'
            }
            foreach ($package in $noTestPackages) {
                $lines.Add((([ordered]@{
                    Time = '2026-07-24T00:00:02Z'
                    Action = 'start'
                    Package = $package
                }) | ConvertTo-Json -Compress -Depth 3))
                $lines.Add((([ordered]@{
                    Time = '2026-07-24T00:00:02Z'
                    Action = 'output'
                    Package = $package
                    Output = "?   `t$package`t[no test files]`n"
                }) | ConvertTo-Json -Compress -Depth 3))
                $lines.Add(
                    '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"' +
                    $package +
                    '","Elapsed":' +
                    $syntheticNoTestElapsed[$package] +
                    '}'
                )
            }
            $valid = New-SemanticSelfTestResult -Label 'selftest.go-discovery.valid' -Lines @($lines)
            Assert-SemanticRawPreserved `
                -Result $valid `
                -Parser { param($result) Assert-GoDiscovery -Result $result } `
                -Label 'Go discovery'

            $run57NoTestEvents = @(
                '{"Time":"2026-07-24T07:21:55.8223992+02:00","Action":"start","Package":"blockxone/cmd/migrate"}'
                '{"Time":"2026-07-24T07:21:55.8223992+02:00","Action":"output","Package":"blockxone/cmd/migrate","Output":"?   \tblockxone/cmd/migrate\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":0.001}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"start","Package":"blockxone/cmd/worker"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"output","Package":"blockxone/cmd/worker","Output":"?   \tblockxone/cmd/worker\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"skip","Package":"blockxone/cmd/worker","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"start","Package":"blockxone/internal/app"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"output","Package":"blockxone/internal/app","Output":"?   \tblockxone/internal/app\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"skip","Package":"blockxone/internal/app","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"start","Package":"blockxone/internal/audit"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"output","Package":"blockxone/internal/audit","Output":"?   \tblockxone/internal/audit\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"skip","Package":"blockxone/internal/audit","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"start","Package":"blockxone/internal/chainlog"}'
                '{"Time":"2026-07-24T07:21:55.8229192+02:00","Action":"output","Package":"blockxone/internal/chainlog","Output":"?   \tblockxone/internal/chainlog\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/chainlog","Elapsed":0.001}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/custody"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/custody","Output":"?   \tblockxone/internal/custody\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/custody","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/db"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/db","Output":"?   \tblockxone/internal/db\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/db","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/events"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/events","Output":"?   \tblockxone/internal/events\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/events","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/examples"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/examples","Output":"?   \tblockxone/internal/examples\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/examples","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/kyc"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/kyc","Output":"?   \tblockxone/internal/kyc\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/kyc","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"start","Package":"blockxone/internal/logging"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"output","Package":"blockxone/internal/logging","Output":"?   \tblockxone/internal/logging\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.8234536+02:00","Action":"skip","Package":"blockxone/internal/logging","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:55.987347+02:00","Action":"start","Package":"blockxone/internal/rbac"}'
                '{"Time":"2026-07-24T07:21:55.987347+02:00","Action":"output","Package":"blockxone/internal/rbac","Output":"?   \tblockxone/internal/rbac\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:55.987347+02:00","Action":"skip","Package":"blockxone/internal/rbac","Elapsed":0}'
                '{"Time":"2026-07-24T07:21:56.8097315+02:00","Action":"start","Package":"blockxone/scripts"}'
                '{"Time":"2026-07-24T07:21:56.8097315+02:00","Action":"output","Package":"blockxone/scripts","Output":"?   \tblockxone/scripts\t[no test files]\n"}'
                '{"Time":"2026-07-24T07:21:56.8097315+02:00","Action":"skip","Package":"blockxone/scripts","Elapsed":0}'
            )
            Assert-Condition (
                $run57NoTestEvents.Count -eq 39
            ) 'Run57 no-test replay must contain exact start/output/skip events for 13 packages'
            $run57NoTestHash = Get-Utf8Sha256 -Text ($run57NoTestEvents -join "`n")
            Assert-Condition (
                $run57NoTestHash -ceq 'A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88'
            ) 'Run57 exact 39-event no-test fixture hash differs'
            $run57NoTestIndices = @(
                2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 21, 22, 23,
                24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 47,
                908, 909, 910
            )
            Assert-Condition (
                $run57NoTestIndices.Count -eq $run57NoTestEvents.Count
            ) 'Run57 no-test index contract must bind every exact no-test event'
            $run57NoTestIndicesHash = Get-Utf8Sha256 -Text ($run57NoTestIndices -join ',')
            Assert-Condition (
                $run57NoTestIndicesHash -ceq '348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8'
            ) 'Run57 exact no-test event index hash differs'
            $representativeTestedEvents = [System.Collections.Generic.List[string]]::new()
            for ($index = 0; $index -lt $testedOnlyLineCount; $index++) {
                $representativeTestedEvents.Add($lines[$index])
            }
            while ($representativeTestedEvents.Count -lt (1598 - $run57NoTestEvents.Count)) {
                $fillerIndex = $representativeTestedEvents.Count - $testedOnlyLineCount
                $fillerPackage = $testedPackages[$fillerIndex % $testedPackages.Count]
                $representativeTestedEvents.Add((([ordered]@{
                    Time = '2026-07-24T00:00:03Z'
                    Action = 'output'
                    Package = $fillerPackage
                    Output = "representative interleaving event $fillerIndex`n"
                }) | ConvertTo-Json -Compress -Depth 3))
            }
            $run57RepresentativeLines = [System.Collections.Generic.List[string]]::new()
            $noTestIndex = 0
            $testedIndex = 0
            for ($globalIndex = 1; $globalIndex -le 1598; $globalIndex++) {
                if (
                    $noTestIndex -lt $run57NoTestIndices.Count -and
                    $globalIndex -eq $run57NoTestIndices[$noTestIndex]
                ) {
                    $run57RepresentativeLines.Add($run57NoTestEvents[$noTestIndex])
                    $noTestIndex++
                }
                else {
                    $run57RepresentativeLines.Add($representativeTestedEvents[$testedIndex])
                    $testedIndex++
                }
            }
            Assert-Condition (
                $run57RepresentativeLines.Count -eq 1598 -and
                $noTestIndex -eq 39 -and
                $testedIndex -eq 1559
            ) 'Run57 representative interleaved stream has an invalid event count'
            $run57Representative = New-SemanticSelfTestResult `
                -Label 'selftest.go-discovery.run57-no-test-representative' `
                -Lines @($run57RepresentativeLines) `
                -ElapsedMilliseconds 6478
            $run57ParserOutput = @(Assert-SemanticRawPreserved `
                -Result $run57Representative `
                -Parser { param($result) Assert-GoDiscovery -Result $result } `
                -Label 'Go discovery exact run57 no-test records in representative interleaved stream' `
                -PassThru)
            $expectedRun57ParserOutput = (
                'GO_TEST_DISCOVERY|passes=357|tested_packages=12|no_test_packages=13|' +
                'package_passes=12|package_skips=13|elapsed_zero=11|elapsed_nonzero=2|' +
                'elapsed_max=0.001|elapsed_bound_seconds=6.728|test_failures=0|' +
                'package_failures=0|test_skips=0|events=1598'
            )
            Assert-Condition (
                $run57ParserOutput.Count -eq 1 -and
                $run57ParserOutput[0] -ceq $expectedRun57ParserOutput
            ) "Run57 representative parser classification differs: actual=[$($run57ParserOutput -join ', ')]"

            $mutations = [ordered]@{
                'duplicate-action' = @($lines)
                'case-colliding-action' = @($lines)
                'unknown-action' = @($lines)
                'duplicate-pass' = @($lines)
                'count-inflation' = @($lines)
                'unknown-property' = @($lines)
                'wrong-type' = @($lines)
                'test-fail' = @($lines)
                'package-fail' = @($lines)
                'missing-no-test-package' = @($lines)
                'extra-no-test-package' = @($lines)
                'duplicate-no-test-skip' = @($lines)
                'test-skip' = @($lines)
                'wrong-no-test-output' = @($lines)
                'tested-no-test-overlap' = @($lines)
                'missing-no-test-start' = @($lines)
                'missing-no-test-output' = @($lines)
                'no-test-output-before-start' = @($lines)
                'no-test-skip-before-output' = @($lines)
                'no-test-skip-string' = @($lines)
                'no-test-skip-bool' = @($lines)
                'no-test-skip-negative' = @($lines)
                'no-test-skip-signed-zero' = @($lines)
                'no-test-skip-exponent' = @($lines)
                'no-test-skip-nonfinite' = @($lines)
                'no-test-skip-overflow' = @($lines)
                'no-test-skip-out-of-bound' = @($lines)
                'no-test-skip-unknown-property' = @($lines)
                'no-test-skip-property-order' = @($lines)
                'no-test-start-property-order' = @($lines)
                'no-test-output-property-order' = @($lines)
                'no-test-pass' = @($lines)
                'no-test-fail' = @($lines)
                'no-test-test-field' = @($lines)
                'no-test-missing-elapsed' = @($lines)
                'no-test-post-terminal-output' = @($lines)
                'duplicate-package-terminal' = @($lines)
                'blank-raw-line' = @($lines)
                'whitespace-raw-line' = @($lines)
            }
            $mutations['duplicate-action'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"pass","Action":"pass","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['case-colliding-action'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"pass","action":"pass","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['unknown-action'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"success","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['duplicate-pass'][356] = $mutations['duplicate-pass'][0]
            $mutations['count-inflation'] = @($mutations['count-inflation'] + '{"Time":"2026-07-24T00:00:00Z","Action":"pass","Package":"blockxone/cmd/api","Test":"TestSemantic357","Elapsed":0.001}')
            $mutations['unknown-property'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"pass","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001,"Status":"ok"}'
            $mutations['wrong-type'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":7,"Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['test-fail'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"fail","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['package-fail'][357] = '{"Time":"2026-07-24T00:00:01Z","Action":"fail","Package":"blockxone/cmd/api","Elapsed":0.001}'
            $firstNoTestStart = 357 + $testedPackages.Count
            $firstNoTestOutput = $firstNoTestStart + 1
            $firstNoTestSkip = $firstNoTestStart + 2
            $lastNoTestSkip = $firstNoTestStart + (($noTestPackages.Count - 1) * 3) + 2
            $missingNoTest = [System.Collections.Generic.List[string]]::new()
            foreach ($line in @($mutations['missing-no-test-package'])) {
                $missingNoTest.Add([string]$line)
            }
            $missingNoTest.RemoveAt($lastNoTestSkip)
            $mutations['missing-no-test-package'] = @($missingNoTest)
            $mutations['extra-no-test-package'] = @(
                $mutations['extra-no-test-package'] +
                '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/internal/unexpected","Elapsed":0}'
            )
            $mutations['duplicate-no-test-skip'] = @(
                $mutations['duplicate-no-test-skip'] +
                $mutations['duplicate-no-test-skip'][$firstNoTestSkip]
            )
            $mutations['test-skip'][0] = '{"Time":"2026-07-24T00:00:00Z","Action":"skip","Package":"blockxone/cmd/api","Test":"TestSemantic000","Elapsed":0.001}'
            $mutations['wrong-no-test-output'][$firstNoTestOutput] = '{"Time":"2026-07-24T00:00:02Z","Action":"output","Package":"blockxone/cmd/migrate","Output":"?   \tblockxone/cmd/migrate\t[no tests]\n"}'
            $mutations['tested-no-test-overlap'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/api","Elapsed":0}'
            foreach ($removal in @(
                [pscustomobject]@{
                    Name = 'missing-no-test-start'
                    Index = $firstNoTestStart
                },
                [pscustomobject]@{
                    Name = 'missing-no-test-output'
                    Index = $firstNoTestOutput
                }
            )) {
                $remaining = [System.Collections.Generic.List[string]]::new()
                foreach ($line in @($mutations[$removal.Name])) {
                    $remaining.Add([string]$line)
                }
                $remaining.RemoveAt([int]$removal.Index)
                $mutations[$removal.Name] = @($remaining)
            }
            $mutations['no-test-output-before-start'][$firstNoTestStart] = $lines[$firstNoTestOutput]
            $mutations['no-test-output-before-start'][$firstNoTestOutput] = $lines[$firstNoTestStart]
            $mutations['no-test-skip-before-output'][$firstNoTestOutput] = $lines[$firstNoTestSkip]
            $mutations['no-test-skip-before-output'][$firstNoTestSkip] = $lines[$firstNoTestOutput]
            $mutations['no-test-skip-string'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":"0.001"}'
            $mutations['no-test-skip-bool'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":true}'
            $mutations['no-test-skip-negative'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":-0.001}'
            $mutations['no-test-skip-signed-zero'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":-0}'
            $mutations['no-test-skip-exponent'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":1e-3}'
            $mutations['no-test-skip-nonfinite'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":1e400}'
            $mutations['no-test-skip-overflow'][$firstNoTestSkip] = (
                '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":' +
                ('9' * 400) +
                '}'
            )
            $mutations['no-test-skip-out-of-bound'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":8}'
            $mutations['no-test-skip-unknown-property'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Elapsed":0.001,"Status":"ok"}'
            $mutations['no-test-skip-property-order'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Package":"blockxone/cmd/migrate","Action":"skip","Elapsed":0.001}'
            $mutations['no-test-start-property-order'][$firstNoTestStart] = '{"Action":"start","Time":"2026-07-24T00:00:02Z","Package":"blockxone/cmd/migrate"}'
            $mutations['no-test-output-property-order'][$firstNoTestOutput] = '{"Time":"2026-07-24T00:00:02Z","Package":"blockxone/cmd/migrate","Action":"output","Output":"?   \tblockxone/cmd/migrate\t[no test files]\n"}'
            $mutations['no-test-pass'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"pass","Package":"blockxone/cmd/migrate","Elapsed":0.001}'
            $mutations['no-test-fail'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"fail","Package":"blockxone/cmd/migrate","Elapsed":0.001}'
            $mutations['no-test-test-field'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate","Test":"TestInjected","Elapsed":0.001}'
            $mutations['no-test-missing-elapsed'][$firstNoTestSkip] = '{"Time":"2026-07-24T00:00:02Z","Action":"skip","Package":"blockxone/cmd/migrate"}'
            $mutations['no-test-post-terminal-output'] = @(
                $mutations['no-test-post-terminal-output'] +
                $lines[$firstNoTestOutput]
            )
            $mutations['duplicate-package-terminal'] = @(
                $mutations['duplicate-package-terminal'] +
                $mutations['duplicate-package-terminal'][357]
            )
            $mutations['blank-raw-line'] = @($mutations['blank-raw-line'] + '')
            $mutations['whitespace-raw-line'] = @($mutations['whitespace-raw-line'] + ' ')
            foreach ($mutation in $mutations.GetEnumerator()) {
                Assert-SemanticParserRejects `
                    -Result (New-SemanticSelfTestResult -Label "selftest.go-discovery.$($mutation.Key)" -Lines @($mutation.Value)) `
                    -Parser { param($result) Assert-GoDiscovery -Result $result } `
                    -Label "Go discovery $($mutation.Key)"
            }
            Write-Output 'GO_DISCOVERY_SEMANTIC_SELFTEST_PASS|passes=357|tested_packages=12|no_test_packages=13|run57_no_test_events=39|run57_no_test_sha256=A51EFCE53E6B68BD6E88E5E4D89DCC1C625DFCD808A06D513E0AD04D1260DD88|run57_no_test_indices_sha256=348422110F0AA1C423320264332903C0D681D9FF7630261401BDCE176D555AD8|synthetic_tested_events=1559|representative_total_events=1598|positive_zero_decimal=1|elapsed_zero=11|elapsed_nonzero=2|elapsed_max=0.001|elapsed_bound_seconds=6.728|negative_cases=39|raw_preserved=1'
        }
        'sharp-script-argument' {
            $integrity = Assert-SharpSmokeScriptIntegrity -Script $script:RequiredSharpSmokeScript
            $injectionCases = @(
                ('x' + $script:RequiredSharpSmokeScript),
                ($script:RequiredSharpSmokeScript + 'x'),
                $script:RequiredSharpSmokeScript.Replace('`SHARP_SMOKE_PASS', 'SHARP_SMOKE_PASS'),
                $script:RequiredSharpSmokeScript.Replace('${png.length}', '${png.byteLength}'),
                $script:RequiredSharpSmokeScript.Replace('solid-red-rgba', 'solid-fed-rgba')
            )
            foreach ($injected in $injectionCases) {
                $rejected = $false
                try {
                    $null = Assert-SharpSmokeScriptIntegrity -Script $injected
                }
                catch {
                    $rejected = $true
                }
                Assert-Condition $rejected 'Sharp smoke integrity gate accepted an injected or altered script'
            }

            $probeScript = 'const crypto=require(''node:crypto'');const s=process.argv[1];const bytes=Buffer.byteLength(s,''utf8'');const sha256=crypto.createHash(''sha256'').update(s,''utf8'').digest(''hex'').toUpperCase();const backticks=(s.match(/`/g)||[]).length;const tokens=(s.match(/\$\{/g)||[]).length;const marker=`SHARP_SCRIPT_ARGUMENT_PASS|bytes=${bytes}|sha256=${sha256}|backticks=${backticks}|tokens=${tokens}`;console.log(marker);if(bytes!==720||sha256!==''99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3''||backticks!==2||tokens!==6)process.exit(9)'
            $argvProbe = Invoke-NativeChecked -Label 'selftest.sharp.argv' -Executable $script:NodePath -Arguments @(
                '-e', $probeScript, $script:RequiredSharpSmokeScript
            ) -WorkingDirectory $script:RepositoryRoot
            Assert-ExactOutputLine -Result $argvProbe -Expected 'SHARP_SCRIPT_ARGUMENT_PASS|bytes=720|sha256=99E0F57352403101C592D34B91591722B049C2C551698A2ED1F072031819F2B3|backticks=2|tokens=6'

            $nativeFailure = $null
            try {
                $null = Invoke-NativeChecked -Label 'selftest.sharp.native-exit7' -Executable $script:NodePath -Arguments @(
                    '-e',
                    'process.stdout.write("SHARP_SMOKE_PASS|fixture=solid-red-rgba|bytes=95|format=png|width=2|height=3|sharp=0.35.3|vips=8.18.3");process.exit(7)'
                ) -WorkingDirectory $script:RepositoryRoot
            }
            catch {
                $nativeFailure = $_
            }
            Assert-Condition (
                $null -ne $nativeFailure -and
                $nativeFailure.Exception -is [NativeCommandFailureException] -and
                $nativeFailure.Exception.NativeExitCode -eq 7
            ) 'Sharp PASS-looking output masked native exit 7'
            Write-Output 'SHARP_NATIVE_EXIT_AUTHORITY_PASS|label=selftest.sharp.native-exit7|exit=7'
            Write-Output "SHARP_SCRIPT_SELFTEST_PASS|bytes=$($integrity.Utf8Bytes)|sha256=$($integrity.Sha256)|argv_exact=1|backticks=$($integrity.Backticks)|tokens=$($integrity.InterpolationTokens)|injection_negatives=$($injectionCases.Count)|native_exit7=1"
        }
        'location-restore' {
            $root = New-SelfTestRoot -Label 'location'
            $subdirectory = Join-Path $root 'working'
            [System.IO.Directory]::CreateDirectory($subdirectory) | Out-Null
            $before = [System.IO.Path]::GetFullPath((Get-Location).Path)
            $null = Invoke-NativeChecked -Label 'selftest.location' -Executable $script:NodePath -Arguments @(
                '-e', 'process.exit(0)'
            ) -WorkingDirectory $subdirectory
            $after = [System.IO.Path]::GetFullPath((Get-Location).Path)
            Assert-Condition ($after -ceq $before) 'Invoke-NativeChecked did not restore the prior location'
        }
        'component-root-reparse' {
            $root = New-SelfTestRoot -Label 'component-root-reparse'
            $realComponent = Join-Path $root 'real-component'
            $componentLink = Join-Path $root 'component-link'
            $quarantine = Join-Path $root 'quarantine'
            [System.IO.Directory]::CreateDirectory((Join-Path $realComponent 'source')) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            New-Item -ItemType Junction -Path $componentLink -Target $realComponent | Out-Null
            $caught = $null
            try {
                $null = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                    Root = $componentLink; Relative = 'source'; Destination = 'destination'
                }) -QuarantineRoot $quarantine
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Reparse-point component root was accepted'
            Assert-Condition (Test-Path -LiteralPath (Join-Path $realComponent 'source')) 'Component-root reparse fixture moved content'
        }
        'terminal-reparse' {
            $root = New-SelfTestRoot -Label 'terminal-reparse'
            $component = Join-Path $root 'component'
            $outside = Join-Path $root 'outside'
            $quarantine = Join-Path $root 'quarantine'
            [System.IO.Directory]::CreateDirectory($component) | Out-Null
            [System.IO.Directory]::CreateDirectory($outside) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            New-Item -ItemType Junction -Path (Join-Path $component 'source') -Target $outside | Out-Null
            $caught = $null
            try {
                $null = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                    Root = $component; Relative = 'source'; Destination = 'destination'
                }) -QuarantineRoot $quarantine
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Terminal reparse fixture was accepted'
            Assert-Condition (Test-Path -LiteralPath $outside) 'Terminal reparse fixture moved outside content'
        }
        'ancestor-reparse' {
            $root = New-SelfTestRoot -Label 'ancestor-reparse'
            $component = Join-Path $root 'component'
            $outside = Join-Path $root 'outside'
            $outsideSource = Join-Path $outside 'source'
            $quarantine = Join-Path $root 'quarantine'
            [System.IO.Directory]::CreateDirectory($component) | Out-Null
            [System.IO.Directory]::CreateDirectory($outsideSource) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            New-Item -ItemType Junction -Path (Join-Path $component 'ancestor') -Target $outside | Out-Null
            $caught = $null
            try {
                $null = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                    Root = $component; Relative = 'ancestor\source'; Destination = 'destination'
                }) -QuarantineRoot $quarantine
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Ancestor reparse fixture was accepted'
            Assert-Condition (Test-Path -LiteralPath $outsideSource) 'Ancestor reparse fixture moved outside content'
        }
        { $_ -in @('destination-preexisting', 'destination-race') } {
            $root = New-SelfTestRoot -Label $Case
            $component = Join-Path $root 'component'
            $quarantine = Join-Path $root 'quarantine'
            [System.IO.Directory]::CreateDirectory($component) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            $source = Join-Path $component 'source.bin'
            [System.IO.File]::WriteAllBytes($source, [byte[]](1, 2, 3, 4, 5))
            $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
            $validated = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                Root = $component; Relative = 'source.bin'; Destination = 'destination.bin'
            }) -QuarantineRoot $quarantine
            if ($Case -ceq 'destination-preexisting') {
                [System.IO.File]::WriteAllText($validated.Destination, 'preexisting')
                $hook = $null
            }
            else {
                $hook = {
                    param($move)
                    [System.IO.File]::WriteAllText($move.Destination, 'injected-race')
                }
            }
            $caught = $null
            try {
                $null = Move-ValidatedGeneratedSource -Validated $validated -BeforeAtomicMove $hook
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) "$Case did not fail"
            Assert-Condition (Test-Path -LiteralPath $source -PathType Leaf) "$Case moved the source"
            Assert-Condition (
                (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ceq $sourceHash
            ) "$Case changed the source bytes"
            Assert-Condition (
                -not (Test-Path -LiteralPath (Join-Path $validated.Destination 'source.bin'))
            ) "$Case nested the source under the destination"
        }
        'quarantine-reparse' {
            $root = New-SelfTestRoot -Label 'quarantine-reparse'
            $real = Join-Path $root 'real-temp'
            $link = Join-Path $root 'temp-link'
            [System.IO.Directory]::CreateDirectory($real) | Out-Null
            New-Item -ItemType Junction -Path $link -Target $real | Out-Null
            $caught = $null
            try {
                $null = New-ValidatedQuarantineRoot -TemporaryRoot $link -Prefix 'blocked-'
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Reparse-point temporary root was accepted'
        }
        'quarantine-root-race' {
            $root = New-SelfTestRoot -Label 'quarantine-root-race'
            $caught = $null
            try {
                $null = New-ValidatedQuarantineRoot -TemporaryRoot $root -Prefix 'raced-' -BeforeCreate {
                    param($candidate)
                    [System.IO.Directory]::CreateDirectory($candidate) | Out-Null
                }
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Race-created quarantine root was silently reused'
        }
        'temporary-root-reparse' {
            $root = New-SelfTestRoot -Label 'temporary-root-reparse'
            $real = Join-Path $root 'real-temporary'
            $link = Join-Path $root 'temporary-link'
            [System.IO.Directory]::CreateDirectory($real) | Out-Null
            New-Item -ItemType Junction -Path $link -Target $real | Out-Null
            $caught = $null
            try {
                $null = New-ValidatedQuarantineRoot -TemporaryRoot $link -Prefix 'blocked-temporary-'
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Reparse-point resolved temporary root was accepted'
        }
        'destination-ancestor-reparse' {
            $root = New-SelfTestRoot -Label 'destination-ancestor-reparse'
            $component = Join-Path $root 'component'
            $quarantine = Join-Path $root 'quarantine'
            $outside = Join-Path $root 'outside'
            [System.IO.Directory]::CreateDirectory((Join-Path $component 'source')) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            [System.IO.Directory]::CreateDirectory($outside) | Out-Null
            New-Item -ItemType Junction -Path (Join-Path $quarantine 'ancestor') -Target $outside | Out-Null
            $caught = $null
            try {
                $null = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                    Root = $component; Relative = 'source'; Destination = 'ancestor\destination'
                }) -QuarantineRoot $quarantine
            }
            catch {
                $caught = $_
            }
            Assert-Condition ($null -ne $caught) 'Reparse-point destination ancestor was accepted'
            Assert-Condition (
                -not (Test-Path -LiteralPath (Join-Path $outside 'destination'))
            ) 'Destination-ancestor fixture escaped containment'
        }
        'parent-preserves-vite' {
            $root = New-SelfTestRoot -Label 'parent-vite'
            $component = Join-Path $root 'component'
            $source = Join-Path $component 'node_modules'
            $nested = Join-Path $source '.vite'
            $quarantine = Join-Path $root 'quarantine'
            [System.IO.Directory]::CreateDirectory($nested) | Out-Null
            [System.IO.Directory]::CreateDirectory($quarantine) | Out-Null
            [System.IO.File]::WriteAllText((Join-Path $nested 'sentinel.txt'), 'nested-vite-content')
            $validated = Get-ValidatedGeneratedSource -InventoryEntry ([pscustomobject]@{
                Root = $component; Relative = 'node_modules'; Destination = 'node-modules'
            }) -QuarantineRoot $quarantine
            $destination = Move-ValidatedGeneratedSource -Validated $validated
            Assert-Condition (
                (Get-Content -LiteralPath (Join-Path $destination '.vite\sentinel.txt') -Raw) -ceq 'nested-vite-content'
            ) 'Parent move did not preserve nested .vite content'
        }
        default {
            throw "Unknown self-test case: $Case"
        }
    }
    Write-Output "PHASE0_RUNNER_SELFTEST_PASS|case=$Case"
}

function Resolve-ToolSet {
    $processPath = [System.Environment]::ProcessPath
    $pwsh = Assert-NonReparsePathChain -Path $processPath -MustExist -ExpectedType File -Label 'PowerShell process executable'
    Assert-Condition (
        [System.IO.Path]::GetFileName($pwsh.FullPath) -ieq 'pwsh.exe' -or
        [System.IO.Path]::GetFileName($pwsh.FullPath) -ceq 'pwsh'
    ) "Current process is not pwsh: $($pwsh.FullPath)"

    return [ordered]@{
        pwsh = $pwsh.FullPath
        node = $script:NodePath
        npmCli = $script:NpmCliPath
        npmShim = $script:NpmShimPath
        go = $script:GoPath
        actionlint = Resolve-ExternalApplication -Name 'actionlint'
        golangciLint = Resolve-ExternalApplication -Name 'golangci-lint'
        gosec = Resolve-ExternalApplication -Name 'gosec'
        govulncheck = Resolve-ExternalApplication -Name 'govulncheck'
        docker = Resolve-ExternalApplication -Name 'docker'
        git = Resolve-ExternalApplication -Name 'git'
    }
}

function Write-ToolRecords {
    param([Parameter(Mandatory)][object]$Tools)

    foreach ($entry in $Tools.GetEnumerator()) {
        $hash = (Get-FileHash -LiteralPath $entry.Value -Algorithm SHA256).Hash
        Write-Output "TOOL_RECORD|name=$($entry.Key)|path=$($entry.Value)|sha256=$hash"
    }
}

function Invoke-ToolIdentityChecks {
    param([Parameter(Mandatory)][object]$Tools)

    $nodeResult = Invoke-NativeChecked -Label 'tool.node.version' -Executable $Tools.node -Arguments @(
        '--version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ExactOutputLine -Result $nodeResult -Expected 'v22.23.1'

    $npmResult = Invoke-NativeChecked -Label 'tool.npm.version' -Executable $Tools.node -Arguments @(
        $Tools.npmCli, '--version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ExactOutputLine -Result $npmResult -Expected '10.9.8'

    Assert-Condition ($env:GOTOOLCHAIN -ceq 'local') 'GOTOOLCHAIN must be local before tool.go.version'
    $goResult = Invoke-NativeChecked -Label 'tool.go.version' -Executable $Tools.go -Arguments @(
        'version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GoVersionIdentity -Result $goResult

    $goEnvResult = Invoke-NativeChecked -Label 'tool.go.toolchain-env' -Executable $Tools.go -Arguments @(
        'env', 'GOTOOLCHAIN'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ExactOutputLine -Result $goEnvResult -Expected 'local'
    Assert-Condition ($env:GOTOOLCHAIN -ceq 'local') 'In-process GOTOOLCHAIN changed during Go identity checks'

    $actionlintResult = Invoke-NativeChecked -Label 'tool.actionlint.version' -Executable $Tools.actionlint -Arguments @(
        '-version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ActionlintIdentity -Result $actionlintResult

    $lintResult = Invoke-NativeChecked -Label 'tool.golangci-lint.version' -Executable $Tools.golangciLint -Arguments @(
        'version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GolangciIdentity -Result $lintResult

    $gosecResult = Invoke-NativeChecked -Label 'tool.gosec.module' -Executable $Tools.go -Arguments @(
        'version', '-m', $Tools.gosec
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GosecModuleIdentity -Result $gosecResult

    $govulnResult = Invoke-NativeChecked -Label 'tool.govulncheck.version' -Executable $Tools.govulncheck -Arguments @(
        '-version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GovulncheckIdentity -Result $govulnResult

    $dockerResult = Invoke-NativeChecked -Label 'tool.docker.version' -Executable $Tools.docker -Arguments @(
        '--version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-DockerIdentity -Result $dockerResult

    $gitResult = Invoke-NativeChecked -Label 'tool.git.version' -Executable $Tools.git -Arguments @(
        '--version'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GitIdentity -Result $gitResult
}

function Assert-FixedMatrixInputs {
    Assert-Condition ($BaselineCommit -ceq $script:RequiredBaselineCommit) 'BaselineCommit differs from Plan 00-12'
    Assert-Condition ($BaselineTree -ceq $script:RequiredBaselineTree) 'BaselineTree differs from Plan 00-12'
    Assert-Condition ($CandidateCommit -ceq $script:RequiredCandidateCommit) 'CandidateCommit differs from Plan 00-12'
    Assert-Condition ($CandidateTree -ceq $script:RequiredCandidateTree) 'CandidateTree differs from Plan 00-12'
    Assert-Condition ($ToolCommit -ceq $script:RequiredToolCommit) 'ToolCommit differs from Plan 00-12'
    Assert-Condition ($ToolTree -ceq $script:RequiredToolTree) 'ToolTree differs from Plan 00-12'
    Assert-Condition ($ToolPath -ceq $script:RequiredToolPath) 'ToolPath differs from Plan 00-12'
    $script:BaselineManifestPath = Assert-LeafHash -Path $BaselineManifest -ExpectedSha256 $script:RequiredBaselineSha256 -Label 'baseline bytecode manifest'
    $script:CandidateManifestPath = Assert-LeafHash -Path $CandidateManifest -ExpectedSha256 $script:RequiredCandidateSha256 -Label 'candidate bytecode manifest'
}

function Assert-GoDiscovery {
    param([Parameter(Mandatory)][object]$Result)

    $allowedProperties = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($name in @('Time', 'Action', 'Package', 'Test', 'Elapsed', 'Output')) {
        $null = $allowedProperties.Add($name)
    }
    $allowedActions = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($action in @('start', 'run', 'pause', 'cont', 'pass', 'bench', 'fail', 'output', 'skip')) {
        $null = $allowedActions.Add($action)
    }
    $expectedTestedPackages = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($package in @(
        'blockxone/cmd/api',
        'blockxone/cmd/seed',
        'blockxone/internal/auth',
        'blockxone/internal/chain',
        'blockxone/internal/config',
        'blockxone/internal/ethsig',
        'blockxone/internal/middleware',
        'blockxone/internal/migrate',
        'blockxone/internal/monitoring',
        'blockxone/internal/payments',
        'blockxone/internal/policy',
        'blockxone/internal/releasepolicy'
    )) {
        $null = $expectedTestedPackages.Add($package)
    }
    $expectedNoTestPackages = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($package in @(
        'blockxone/cmd/migrate',
        'blockxone/cmd/worker',
        'blockxone/internal/app',
        'blockxone/internal/audit',
        'blockxone/internal/chainlog',
        'blockxone/internal/custody',
        'blockxone/internal/db',
        'blockxone/internal/events',
        'blockxone/internal/examples',
        'blockxone/internal/kyc',
        'blockxone/internal/logging',
        'blockxone/internal/rbac',
        'blockxone/scripts'
    )) {
        Assert-Condition (
            -not $expectedTestedPackages.Contains($package)
        ) "Go discovery package contract overlaps tested and no-test sets: $package"
        $null = $expectedNoTestPackages.Add($package)
    }
    $elapsedProperty = $Result.PSObject.Properties['ElapsedMilliseconds']
    Assert-Condition (
        $null -ne $elapsedProperty -and
        $elapsedProperty.Value -is [long] -and
        [long]$elapsedProperty.Value -ge 0
    ) 'go.test.discovery result must expose nonnegative Int64 ElapsedMilliseconds'
    # Go's JSON Elapsed value is seconds. Permit only a small scheduling/rounding
    # margin beyond the measured native-command wall time, never an unbounded value.
    [double]$maxNoTestElapsedSeconds = (
        ([double][long]$elapsedProperty.Value / 1000d) +
        0.250d
    )

    $eventCount = 0
    $testPassCount = 0
    $testFailureCount = 0
    $packageFailureCount = 0
    $testSkipCount = 0
    $passIdentities = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $testedPackages = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $packagePasses = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $packageTerminals = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestStarts = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestOutputs = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestSkips = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestStates = [System.Collections.Generic.Dictionary[string,int]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestElapsedRaw = [System.Collections.Generic.Dictionary[string,string]]::new(
        [System.StringComparer]::Ordinal
    )
    $noTestElapsedZeroCount = 0
    $noTestElapsedNonzeroCount = 0
    [double]$maxObservedNoTestElapsedSeconds = 0d
    foreach ($package in $expectedNoTestPackages) {
        $noTestStates.Add($package, 0)
    }
    foreach ($line in @(Get-RawOutputLines -Result $Result)) {
        Assert-Condition (
            -not [string]::IsNullOrWhiteSpace([string]$line)
        ) 'go.test.discovery returned an empty or whitespace raw line'
        $document = $null
        try {
            $document = [System.Text.Json.JsonDocument]::Parse([string]$line)
        }
        catch {
            throw "go.test.discovery returned a non-JSON line: $line"
        }
        try {
            Assert-Condition (
                $document.RootElement.ValueKind -eq [System.Text.Json.JsonValueKind]::Object
            ) 'go.test.discovery JSON event root must be an object'
            $properties = [System.Collections.Generic.Dictionary[string,System.Text.Json.JsonElement]]::new(
                [System.StringComparer]::OrdinalIgnoreCase
            )
            $propertyNames = [System.Collections.Generic.List[string]]::new()
            foreach ($property in $document.RootElement.EnumerateObject()) {
                Assert-Condition (
                    $allowedProperties.Contains($property.Name)
                ) "go.test.discovery JSON event has unknown or case-drifted property: $($property.Name)"
                Assert-Condition (
                    $properties.TryAdd($property.Name, $property.Value.Clone())
                ) "go.test.discovery JSON event has duplicate or case-colliding property: $($property.Name)"
                $propertyNames.Add($property.Name)
            }
            foreach ($required in @('Time', 'Action', 'Package')) {
                Assert-Condition (
                    $properties.ContainsKey($required)
                ) "go.test.discovery JSON event is missing required property: $required"
                Assert-Condition (
                    $properties[$required].ValueKind -eq [System.Text.Json.JsonValueKind]::String
                ) "go.test.discovery JSON property $required must be a string"
            }
            foreach ($optionalString in @('Test', 'Output')) {
                if ($properties.ContainsKey($optionalString)) {
                    Assert-Condition (
                        $properties[$optionalString].ValueKind -eq [System.Text.Json.JsonValueKind]::String
                    ) "go.test.discovery JSON property $optionalString must be a string"
                }
            }
            if ($properties.ContainsKey('Elapsed')) {
                Assert-Condition (
                    $properties['Elapsed'].ValueKind -eq [System.Text.Json.JsonValueKind]::Number
                ) 'go.test.discovery JSON property Elapsed must be a number'
            }

            $action = $properties['Action'].GetString()
            $package = $properties['Package'].GetString()
            $time = $properties['Time'].GetString()
            $test = if ($properties.ContainsKey('Test')) {
                $properties['Test'].GetString()
            }
            else {
                ''
            }
            Assert-Condition (
                $allowedActions.Contains($action)
            ) "go.test.discovery JSON event has unknown Action: $action"
            Assert-Condition (
                -not [string]::IsNullOrEmpty($package)
            ) 'go.test.discovery JSON event has an empty Package'
            Assert-Condition (
                -not [string]::IsNullOrEmpty($time)
            ) 'go.test.discovery JSON event has an empty Time'
            Assert-Condition (
                $expectedTestedPackages.Contains($package) -or
                $expectedNoTestPackages.Contains($package)
            ) "go.test.discovery JSON event names an unexpected package: $package"
            $eventCount++
            if ($expectedNoTestPackages.Contains($package)) {
                # The pinned Go 1.26.5 raw stream is hash-bound in the self-test.
                # Preserve its exact action-specific property order as part of that
                # raw-format contract while allowing unrelated packages to interleave.
                Assert-Condition (
                    [string]::IsNullOrEmpty($test)
                ) "go.test.discovery no-test package emitted a test-level event: package=$package; test=$test"
                Assert-Condition (
                    $action -cin @('start', 'output', 'skip')
                ) "go.test.discovery no-test package emitted an invalid action: package=$package; action=$action"
                $propertyShape = $propertyNames -join ','
                $state = $noTestStates[$package]
                if ($action -ceq 'start') {
                    Assert-Condition (
                        $propertyShape -ceq 'Time,Action,Package'
                    ) "go.test.discovery no-test package start has malformed or reordered properties: $package"
                    Assert-Condition (
                        $state -eq 0
                    ) "go.test.discovery no-test package start is duplicated or out of order: $package"
                    Assert-Condition (
                        $noTestStarts.Add($package)
                    ) "go.test.discovery duplicated a no-test package start: $package"
                    $noTestStates[$package] = 1
                }
                elseif ($action -ceq 'output') {
                    Assert-Condition (
                        $propertyShape -ceq 'Time,Action,Package,Output'
                    ) "go.test.discovery no-test package output has malformed or reordered properties: $package"
                    Assert-Condition (
                        $state -eq 1
                    ) "go.test.discovery no-test package output is duplicated or out of order: $package"
                    $expectedOutput = "?   `t$package`t[no test files]`n"
                    Assert-Condition (
                        $properties['Output'].GetString() -ceq $expectedOutput
                    ) "go.test.discovery no-test package output differs from exact Go output: $package"
                    Assert-Condition (
                        $noTestOutputs.Add($package)
                    ) "go.test.discovery duplicated a no-test package output: $package"
                    $noTestStates[$package] = 2
                }
                else {
                    Assert-Condition (
                        $propertyShape -ceq 'Time,Action,Package,Elapsed'
                    ) "go.test.discovery no-test package skip has malformed or reordered properties: $package"
                    Assert-Condition (
                        $state -eq 2
                    ) "go.test.discovery no-test package skip is duplicated or out of order: $package"
                    $elapsedRaw = $properties['Elapsed'].GetRawText()
                    Assert-Condition (
                        [regex]::IsMatch(
                            $elapsedRaw,
                            '\A(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\z',
                            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant,
                            [timespan]::FromSeconds(1)
                        )
                    ) "go.test.discovery no-test package Elapsed is not plain nonnegative decimal JSON: package=$package; raw=$elapsedRaw"
                    [double]$elapsedSeconds = 0d
                    $elapsedParsed = $properties['Elapsed'].TryGetDouble(
                        [ref]$elapsedSeconds
                    )
                    Assert-Condition (
                        $elapsedParsed -and
                        [double]::IsFinite($elapsedSeconds) -and
                        $elapsedSeconds -ge 0d -and
                        $elapsedSeconds -le $maxNoTestElapsedSeconds
                    ) "go.test.discovery no-test package Elapsed exceeds its bounded command duration: package=$package; raw=$elapsedRaw; max=$maxNoTestElapsedSeconds"
                    Assert-Condition (
                        $noTestElapsedRaw.TryAdd($package, $elapsedRaw)
                    ) "go.test.discovery duplicated no-test Elapsed evidence: $package"
                    if ($elapsedSeconds -eq 0d) {
                        $noTestElapsedZeroCount++
                    }
                    else {
                        $noTestElapsedNonzeroCount++
                    }
                    if ($elapsedSeconds -gt $maxObservedNoTestElapsedSeconds) {
                        $maxObservedNoTestElapsedSeconds = $elapsedSeconds
                    }
                    Assert-Condition (
                        $noTestSkips.Add($package)
                    ) "go.test.discovery duplicated a no-test package skip: $package"
                    Assert-Condition (
                        $packageTerminals.Add($package)
                    ) "go.test.discovery duplicated or conflicted a package terminal: $package"
                    $noTestStates[$package] = 3
                }
                continue
            }

            if ($action -ceq 'fail') {
                if ([string]::IsNullOrEmpty($test)) {
                    $packageFailureCount++
                }
                else {
                    $testFailureCount++
                }
            }
            if (
                $action -ceq 'skip'
            ) {
                Assert-Condition (
                    -not [string]::IsNullOrEmpty($test)
                ) "go.test.discovery tested package emitted a package-level skip: $package"
                $testSkipCount++
            }
            if (
                $action -cin @('pass', 'fail') -and
                [string]::IsNullOrEmpty($test)
            ) {
                Assert-Condition (
                    $packageTerminals.Add($package)
                ) "go.test.discovery duplicated or conflicted a package terminal: $package"
                if ($action -ceq 'pass') {
                    Assert-Condition (
                        $expectedTestedPackages.Contains($package)
                    ) "go.test.discovery unexpected package-level pass: $package"
                    $null = $packagePasses.Add($package)
                }
            }
            if ($action -ceq 'pass' -and -not [string]::IsNullOrEmpty($test)) {
                $identity = "$package`0$test"
                Assert-Condition (
                    $passIdentities.Add($identity)
                ) "go.test.discovery duplicated a test pass event: package=$package; test=$test"
                $null = $testedPackages.Add($package)
                $testPassCount++
            }
        }
        finally {
            $document.Dispose()
        }
    }
    Assert-Condition ($testPassCount -eq 357) "Go discovery expected exactly 357 unique passing tests/subtests; found=$testPassCount"
    Assert-Condition (
        $testedPackages.SetEquals($expectedTestedPackages)
    ) "Go discovery tested package set differs; actual=[$(@($testedPackages) -join ', ')]"
    Assert-Condition (
        $packagePasses.SetEquals($expectedTestedPackages)
    ) "Go discovery tested package terminal set differs; actual=[$(@($packagePasses) -join ', ')]"
    Assert-Condition (
        $noTestStarts.SetEquals($expectedNoTestPackages)
    ) "Go discovery no-test package start set differs; actual=[$(@($noTestStarts) -join ', ')]"
    Assert-Condition (
        $noTestOutputs.SetEquals($expectedNoTestPackages)
    ) "Go discovery no-test package output set differs; actual=[$(@($noTestOutputs) -join ', ')]"
    Assert-Condition (
        $noTestSkips.SetEquals($expectedNoTestPackages)
    ) "Go discovery no-test package skip set differs; actual=[$(@($noTestSkips) -join ', ')]"
    foreach ($package in $expectedNoTestPackages) {
        Assert-Condition (
            $noTestStates[$package] -eq 3
        ) "Go discovery no-test package did not complete start/output/skip state machine: $package"
    }
    Assert-Condition (
        $noTestElapsedRaw.Keys.Count -eq $expectedNoTestPackages.Count -and
        $expectedNoTestPackages.SetEquals(
            [System.Collections.Generic.HashSet[string]]::new(
                [string[]]@($noTestElapsedRaw.Keys),
                [System.StringComparer]::Ordinal
            )
        )
    ) "Go discovery no-test Elapsed evidence set differs; actual=[$(@($noTestElapsedRaw.Keys) -join ', ')]"
    Assert-Condition (
        ($noTestElapsedZeroCount + $noTestElapsedNonzeroCount) -eq $expectedNoTestPackages.Count
    ) 'Go discovery no-test Elapsed classification count differs'
    Assert-Condition (
        $packageTerminals.Count -eq (
            $expectedTestedPackages.Count + $expectedNoTestPackages.Count
        )
    ) "Go discovery package terminal count differs; actual=$($packageTerminals.Count)"
    Assert-Condition ($testFailureCount -eq 0) "Go discovery found test failure events: $testFailureCount"
    Assert-Condition ($packageFailureCount -eq 0) "Go discovery found package failure events: $packageFailureCount"
    Assert-Condition ($testSkipCount -eq 0) "Go discovery found test-level skip events: $testSkipCount"
    $elapsedMaxText = $maxObservedNoTestElapsedSeconds.ToString(
        '0.#################',
        [System.Globalization.CultureInfo]::InvariantCulture
    )
    $elapsedBoundText = $maxNoTestElapsedSeconds.ToString(
        '0.#################',
        [System.Globalization.CultureInfo]::InvariantCulture
    )
    Write-Output (
        "GO_TEST_DISCOVERY|passes=$testPassCount|tested_packages=$($testedPackages.Count)|" +
        "no_test_packages=$($noTestSkips.Count)|package_passes=$($packagePasses.Count)|" +
        "package_skips=$($noTestSkips.Count)|elapsed_zero=$noTestElapsedZeroCount|" +
        "elapsed_nonzero=$noTestElapsedNonzeroCount|elapsed_max=$elapsedMaxText|" +
        "elapsed_bound_seconds=$elapsedBoundText|test_failures=0|package_failures=0|" +
        "test_skips=0|events=$eventCount"
    )
}

function Invoke-ProductionMatrixBeforeCleanup {
    param([Parameter(Mandatory)][object]$Tools)

    $planning = Invoke-PwshChecked -Label 'planning.validate' -Arguments @(
        '-NoProfile', '-File', '.\.planning\scripts\validate-planning.ps1', '-ResidueMode', 'CleanCandidate'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-PlanningValidatorOutput -Result $planning

    $artifacts = Invoke-PwshChecked -Label 'artifacts.validate' -Arguments @(
        '-NoProfile', '-File', '.\.planning\scripts\validate-repository-artifacts.ps1'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ArtifactValidatorOutput -Result $artifacts
    $ciPolicy = Invoke-PwshChecked -Label 'ci-policy.validate' -Arguments @(
        '-NoProfile', '-File', '.\.planning\scripts\validate-ci-policy.ps1'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-CiPolicyOutput -Result $ciPolicy
    $composePolicy = Invoke-PwshChecked -Label 'compose-policy.validate' -Arguments @(
        '-NoProfile', '-File', '.\.planning\scripts\validate-production-compose.ps1'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ComposePolicyOutput -Result $composePolicy

    $actionlint = Invoke-NativeChecked -Label 'workflows.actionlint' -Executable $Tools.actionlint -Arguments @(
        '-no-color'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ZeroRawOutput -Result $actionlint

    $moduleVerify = Invoke-GoChecked -Label 'go.module-verify' -Arguments @(
        'mod', 'verify'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ExactOutputLine -Result $moduleVerify -Expected 'all modules verified'

    $null = Invoke-GoChecked -Label 'go.test' -Arguments @(
        'test', '-count=1', '.\cmd\...', '.\internal\...', '.\scripts\...'
    ) -WorkingDirectory $script:RepositoryRoot
    $goDiscovery = Invoke-GoChecked -Label 'go.test.discovery' -Arguments @(
        'test', '-count=1', '-json', '.\cmd\...', '.\internal\...', '.\scripts\...'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GoDiscovery -Result $goDiscovery

    $vet = Invoke-GoChecked -Label 'go.vet' -Arguments @(
        'vet', '.\cmd\...', '.\internal\...', '.\scripts\...'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ZeroRawOutput -Result $vet
    $lint = Invoke-NativeChecked -Label 'go.lint' -Executable $Tools.golangciLint -Arguments @(
        'run', '--timeout', '5m', '.\cmd\...', '.\internal\...', '.\scripts\...'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GolangciZeroIssues -Result $lint

    $gosec = Invoke-NativeChecked -Label 'go.gosec' -Executable $Tools.gosec -Arguments @(
        '-tests', '-severity', 'medium', '-confidence', 'medium', '.\cmd\...', '.\internal\...'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GosecZeroIssues -Result $gosec

    $govuln = Invoke-NativeChecked -Label 'go.govulncheck' -Executable $Tools.govulncheck -Arguments @(
        '.\cmd\...', '.\internal\...', '.\scripts\...'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-GovulnReachableZero -Result $govuln

    $goRestoreFailureCount = $script:LifecycleCleanupErrors.Count
    try {
        Restore-ProcessEnvironmentState -State $script:PriorGoToolchain
        $script:GoToolchainRestored = $true
    }
    catch {
        $script:LifecycleCleanupErrors.Add($_)
    }
    if ($script:LifecycleCleanupErrors.Count -ne $goRestoreFailureCount) {
        throw 'Matrix stopped because GOTOOLCHAIN restoration failed'
    }

    $webInstall = Invoke-NpmChecked -Label 'web.install' -Arguments @(
        'ci', '--prefix', 'apps/web'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-NpmInstallSummary -Result $webInstall

    $sharpScript = $script:RequiredSharpSmokeScript
    $null = Assert-SharpSmokeScriptIntegrity -Script $sharpScript
    $sharp = Invoke-NativeChecked -Label 'web.sharp-smoke' -Executable $script:NodePath -Arguments @(
        '-e', $sharpScript
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ExactOutputLine -Result $sharp -Expected 'SHARP_SMOKE_PASS|fixture=solid-red-rgba|bytes=95|format=png|width=2|height=3|sharp=0.35.3|vips=8.18.3'

    $webPreflight = Invoke-NpmChecked -Label 'web.preflight-tests' -Arguments @(
        'run', 'test:preflight', '--prefix', 'apps/web'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-TapSummary -Result $webPreflight -ExpectedTests 4

    $webConfig = Invoke-NpmChecked -Label 'web.config-tests' -Arguments @(
        'run', 'test:config', '--prefix', 'apps/web'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-TapSummary -Result $webConfig -ExpectedTests 5

    $webRunner = Invoke-NpmChecked -Label 'web.runner-tests' -Arguments @(
        'run', 'test:runner', '--prefix', 'apps/web'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-TapSummary -Result $webRunner -ExpectedTests 21

    $webRootUnit = Invoke-NpmChecked -Label 'web.unit.repo-root' -Arguments @(
        'test', '--prefix', 'apps/web', '--', '--run'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-VitestSummary -Result $webRootUnit -ExpectedTests 92 -ExpectedFiles 3

    [System.Environment]::SetEnvironmentVariable('NEXT_PUBLIC_API_URL', 'https://api.blockxone.example', 'Process')
    [System.Environment]::SetEnvironmentVariable('SERVER_ACTION_ALLOWED_ORIGINS', 'app.blockxone.example', 'Process')
    $script:WebFixtureEnvironmentActive = $true

    $webPackageUnit = Invoke-NpmChecked -Label 'web.unit.package-root' -Arguments @(
        'test', '--', '--run'
    ) -WorkingDirectory $script:WebRoot
    Assert-VitestSummary -Result $webPackageUnit -ExpectedTests 92 -ExpectedFiles 3

    $webLint = Invoke-NpmChecked -Label 'web.lint' -Arguments @(
        'run', 'lint'
    ) -WorkingDirectory $script:WebRoot
    Assert-WebLintSummary -Result $webLint
    $webAuditFullPre = Invoke-NpmChecked -Label 'web.audit.full.pre-build' -Arguments @(
        'audit', '--audit-level=moderate'
    ) -WorkingDirectory $script:WebRoot
    Assert-NpmAuditZero -Result $webAuditFullPre
    $webAuditRuntimePre = Invoke-NpmChecked -Label 'web.audit.runtime.pre-build' -Arguments @(
        'audit', '--omit=dev', '--audit-level=moderate'
    ) -WorkingDirectory $script:WebRoot
    Assert-NpmAuditZero -Result $webAuditRuntimePre

    $webBuild = Invoke-NpmChecked -Label 'web.build' -Arguments @(
        'run', 'build'
    ) -WorkingDirectory $script:WebRoot
    Assert-NextBuildSummary -Result $webBuild

    $webContainment = Invoke-NpmChecked -Label 'web.production-containment' -Arguments @(
        'run', 'test:production-containment'
    ) -WorkingDirectory $script:WebRoot
    Assert-ProductionContainmentOutput -Result $webContainment
    $webAuditFullPost = Invoke-NpmChecked -Label 'web.audit.full.post-containment' -Arguments @(
        'audit', '--audit-level=moderate'
    ) -WorkingDirectory $script:WebRoot
    Assert-NpmAuditZero -Result $webAuditFullPost
    $webAuditRuntimePost = Invoke-NpmChecked -Label 'web.audit.runtime.post-containment' -Arguments @(
        'audit', '--omit=dev', '--audit-level=moderate'
    ) -WorkingDirectory $script:WebRoot
    Assert-NpmAuditZero -Result $webAuditRuntimePost

    Restore-ProcessEnvironmentState -State $script:PriorNextPublicApiUrl
    Restore-ProcessEnvironmentState -State $script:PriorServerActionAllowedOrigins
    $script:WebFixtureEnvironmentActive = $false

    $contractsInstall = Invoke-NpmChecked -Label 'contracts.install' -Arguments @(
        'ci', '--ignore-scripts'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-NpmInstallSummary -Result $contractsInstall
    $contractsPreflight = Invoke-NpmChecked -Label 'contracts.preflight-tests' -Arguments @(
        'run', 'test:preflight'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-TapSummary -Result $contractsPreflight -ExpectedTests 10

    $contractsCompile = Invoke-NpmChecked -Label 'contracts.compile' -Arguments @(
        'run', 'compile'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-HardhatCompileSummary -Result $contractsCompile
    $contractsTypecheck = Invoke-NpmChecked -Label 'contracts.typecheck' -Arguments @(
        'run', 'typecheck'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-ContractsPreflightOutput -Result $contractsTypecheck
    $contractsFull = Invoke-NpmChecked -Label 'contracts.test.full' -Arguments @(
        'test'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-HardhatTestSummary -Result $contractsFull -ExpectedTests 59
    $contractsIdentity = Invoke-NpmChecked -Label 'contracts.test.identity' -Arguments @(
        'test', '--', 'test/IdentityRegistry.test.ts'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-HardhatTestSummary -Result $contractsIdentity -ExpectedTests 16
    $contractsToken = Invoke-NpmChecked -Label 'contracts.test.token' -Arguments @(
        'test', '--', 'test/BXOSecurityToken.test.ts'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-HardhatTestSummary -Result $contractsToken -ExpectedTests 36
    $contractsFactory = Invoke-NpmChecked -Label 'contracts.test.factory' -Arguments @(
        'test', '--', 'test/BXOSecurityTokenFactory.test.ts'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-HardhatTestSummary -Result $contractsFactory -ExpectedTests 5
    $contractsRuntimeAudit = Invoke-NpmChecked -Label 'contracts.audit.runtime' -Arguments @(
        'audit', '--omit=dev', '--audit-level=moderate'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-NpmAuditZero -Result $contractsRuntimeAudit
    $contractsFullAudit = Invoke-NpmChecked -Label 'contracts.audit.full' -Arguments @(
        'audit', '--audit-level=moderate'
    ) -WorkingDirectory $script:ContractsRoot
    Assert-NpmAuditZero -Result $contractsFullAudit

    $comparisonRoot = New-ValidatedQuarantineRoot -Prefix 'blockxone-bytecode-replay-'
    $comparisonOutput = Join-Path $comparisonRoot 'bytecode-comparison.json'
    Write-Output (
        "BYTECODE_REPLAY_ARGUMENTS|baseline=$script:BaselineManifestPath|baseline_sha256=$script:RequiredBaselineSha256" +
        "|candidate=$script:CandidateManifestPath|candidate_sha256=$script:RequiredCandidateSha256" +
        "|baseline_commit=$BaselineCommit|baseline_tree=$BaselineTree|candidate_commit=$CandidateCommit" +
        "|candidate_tree=$CandidateTree|tool_commit=$ToolCommit|tool_tree=$ToolTree|tool_path=$ToolPath" +
        "|git=$($Tools.git)|repo=$script:RepositoryRoot|output=$comparisonOutput"
    )
    $bytecode = Invoke-NativeChecked -Label 'bytecode.compare' -Executable $script:NodePath -Arguments @(
        'contracts/scripts/compare-bytecode-manifests.mjs',
        '--baseline', $script:BaselineManifestPath,
        '--candidate', $script:CandidateManifestPath,
        '--capture-script', 'contracts/scripts/capture-bytecode-manifest.mjs',
        '--git-executable', $Tools.git,
        '--git-repo', $script:RepositoryRoot,
        '--repo-contracts-root', 'contracts',
        '--baseline-commit', $BaselineCommit,
        '--baseline-tree', $BaselineTree,
        '--candidate-commit', $CandidateCommit,
        '--candidate-tree', $CandidateTree,
        '--tool-commit', $ToolCommit,
        '--tool-tree', $ToolTree,
        '--tool-path', $ToolPath,
        '--out', $comparisonOutput
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-BytecodeComparatorOutput -Result $bytecode
    $comparisonHash = (Get-FileHash -LiteralPath $comparisonOutput -Algorithm SHA256).Hash
    Assert-Condition (
        $comparisonHash -ceq $script:RequiredComparisonSha256
    ) "Bytecode replay hash mismatch: $comparisonHash"
    Assert-BytecodeComparisonJson -Path $comparisonOutput
    Write-Output "BYTECODE_REPLAY_PASS|path=$comparisonOutput|sha256=$comparisonHash|compiler_contracts=43|user_artifacts=27|scope=preserved-configuration-only"

    $composeRender = Invoke-NativeChecked -Label 'compose.render.raw' -Executable $Tools.docker -Arguments @(
        'compose', '--env-file', 'config/production.env.example', '-f', 'docker-compose.prod.yml', 'config', '--quiet'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-ZeroRawOutput -Result $composeRender
}

$script:RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$repositoryState = Assert-NonReparsePathChain -Path $script:RepositoryRoot -MustExist -ExpectedType Directory -Label 'repository root'
$script:RepositoryRoot = $repositoryState.FullPath
$script:WebRoot = (Assert-NonReparsePathChain -Path (Join-Path $script:RepositoryRoot 'apps\web') -MustExist -ExpectedType Directory -Label 'web root').FullPath
$script:ContractsRoot = (Assert-NonReparsePathChain -Path (Join-Path $script:RepositoryRoot 'contracts') -MustExist -ExpectedType Directory -Label 'contracts root').FullPath

$script:NodePath = Assert-LeafHash -Path $NodeExecutable -ExpectedSha256 $script:RequiredNodeSha256 -ExpectedPath $script:RequiredNodePath -Label 'pinned Node executable'
$script:NpmCliPath = Assert-LeafHash -Path $NpmCli -ExpectedSha256 $script:RequiredNpmCliSha256 -ExpectedPath $script:RequiredNpmCliPath -Label 'pinned npm CLI'
$script:GoPath = Assert-LeafHash -Path $GoExecutable -ExpectedSha256 $script:RequiredGoSha256 -ExpectedPath $script:RequiredGoPath -Label 'pinned Go executable'
if (
    $PSCmdlet.ParameterSetName -ceq 'SelfTest' -and
    $SelfTestCase -ceq 'path-absent' -and
    $env:PHASE0_SELFTEST_PATH_ABSENT -ceq '1'
) {
    Remove-Item -LiteralPath 'Env:PATH' -Force -ErrorAction SilentlyContinue
}
elseif (
    $PSCmdlet.ParameterSetName -ceq 'SelfTest' -and
    $SelfTestCase -ceq 'path-valued' -and
    $env:PHASE0_SELFTEST_PATH_VALUE -ceq 'selftest-path-prior'
) {
    [System.Environment]::SetEnvironmentVariable('PATH', $env:PHASE0_SELFTEST_PATH_VALUE, 'Process')
}
$script:PriorPath = Get-ProcessEnvironmentState -Name 'PATH'
$nodeDirectory = Split-Path -Parent $script:NodePath
$goDirectory = Split-Path -Parent $script:GoPath
$null = Assert-NonReparsePathChain -Path $goDirectory -MustExist -ExpectedType Directory -Label 'pinned Go directory'
$npmPackageRoot = Split-Path -Parent (Split-Path -Parent $script:NpmCliPath)
$npmNodeModulesRoot = Split-Path -Parent $npmPackageRoot
$npmShimDirectory = Join-Path $npmNodeModulesRoot '.bin'
$npmShim = Join-Path $npmShimDirectory 'npm.cmd'
$script:NpmShimPath = Assert-LeafHash -Path $npmShim -ExpectedSha256 $script:RequiredNpmShimSha256 -ExpectedPath 'C:\Users\danie\AppData\Local\npm-cache\_npx\d8f2e63c6145eb9d\node_modules\.bin\npm.cmd' -Label 'pinned npm shim'
$pathParts = [System.Collections.Generic.List[string]]::new()
$pathParts.Add($nodeDirectory)
$pathParts.Add($npmShimDirectory)
$pathParts.Add($goDirectory)
if ($script:PriorPath.Present -and -not [string]::IsNullOrEmpty($script:PriorPath.Value)) {
    $pathParts.Add($script:PriorPath.Value)
}
[System.Environment]::SetEnvironmentVariable('PATH', ($pathParts -join [System.IO.Path]::PathSeparator), 'Process')
$script:PathRestored = $false

if ($PSCmdlet.ParameterSetName -ceq 'SelfTest') {
    $selfTestFailure = $null
    $selfTestPathRestoreFailure = $null
    try {
        Invoke-RunnerSelfTest -Case $SelfTestCase
    }
    catch {
        $selfTestFailure = $_
    }
    finally {
        try {
            Restore-ProcessEnvironmentState -State $script:PriorPath
            $restoredSelfTestPath = Get-ProcessEnvironmentState -Name 'PATH'
            Assert-Condition (
                (Test-EnvironmentStateEqual -Left $restoredSelfTestPath -Right $script:PriorPath)
            ) 'Self-test outer PATH restoration was not exact'
            $script:PathRestored = $true
        }
        catch {
            $selfTestPathRestoreFailure = $_
        }
    }
    if ($null -ne $selfTestPathRestoreFailure) {
        [System.Console]::Error.WriteLine(
            "SELFTEST_PATH_RESTORE_FAILED|$(Get-FailureText $selfTestPathRestoreFailure)"
        )
        if ($null -ne $selfTestFailure) {
            [System.Console]::Error.WriteLine(
                "SELFTEST_PRIMARY_FAILURE_PRESERVED|$(Get-FailureText $selfTestFailure)"
            )
        }
        exit 1
    }
    Write-Output 'SELFTEST_PATH_RESTORED=EXACT'
    if ($null -ne $selfTestFailure) {
        [System.Console]::Error.WriteLine((Get-FailureText $selfTestFailure))
        if ($selfTestFailure.Exception -is [NativeCommandFailureException]) {
            exit $selfTestFailure.Exception.NativeExitCode
        }
        exit 1
    }
    return
}

Assert-FixedMatrixInputs
$tools = Resolve-ToolSet
$script:PwshPath = $tools.pwsh
Write-Output "POWERSHELL_IN_PROCESS_VERSION=$($PSVersionTable.PSVersion)"
Write-Output "POWERSHELL_PROCESS_PATH=$([System.Environment]::ProcessPath)"
Write-ToolRecords -Tools $tools

$script:PriorGoToolchain = Get-ProcessEnvironmentState -Name 'GOTOOLCHAIN'
$script:PriorNextPublicApiUrl = Get-ProcessEnvironmentState -Name 'NEXT_PUBLIC_API_URL'
$script:PriorServerActionAllowedOrigins = Get-ProcessEnvironmentState -Name 'SERVER_ACTION_ALLOWED_ORIGINS'
$script:GoToolchainRestored = $false
$script:WebFixtureEnvironmentActive = $false
$script:LifecycleCleanupErrors = [System.Collections.Generic.List[object]]::new()
$primaryFailure = $null
$generatedCleanup = $null

try {
    [System.Environment]::SetEnvironmentVariable('GOTOOLCHAIN', 'local', 'Process')
    Assert-Condition ($env:GOTOOLCHAIN -ceq 'local') 'Unable to set in-process GOTOOLCHAIN=local'
    Invoke-ToolIdentityChecks -Tools $tools

    $runnerTests = Invoke-NativeChecked -Label 'runner.tests' -Executable $tools.pwsh -Arguments @(
        '-NoProfile', '-File', '.\.planning\scripts\test-phase0-matrix-runner.ps1'
    ) -WorkingDirectory $script:RepositoryRoot
    Assert-RunnerTestsOutput -Result $runnerTests

    Invoke-ProductionMatrixBeforeCleanup -Tools $tools
}
catch {
    $primaryFailure = $_
}
finally {
    if (-not $script:GoToolchainRestored) {
        try {
            Restore-ProcessEnvironmentState -State $script:PriorGoToolchain
            $script:GoToolchainRestored = $true
        }
        catch {
            $script:LifecycleCleanupErrors.Add($_)
        }
    }
    if ($script:WebFixtureEnvironmentActive) {
        try {
            Restore-ProcessEnvironmentState -State $script:PriorNextPublicApiUrl
        }
        catch {
            $script:LifecycleCleanupErrors.Add($_)
        }
        try {
            Restore-ProcessEnvironmentState -State $script:PriorServerActionAllowedOrigins
        }
        catch {
            $script:LifecycleCleanupErrors.Add($_)
        }
        $script:WebFixtureEnvironmentActive = $false
    }
    if (-not $script:PathRestored) {
        try {
            Restore-ProcessEnvironmentState -State $script:PriorPath
            $restoredMatrixPath = Get-ProcessEnvironmentState -Name 'PATH'
            Assert-Condition (
                (Test-EnvironmentStateEqual -Left $restoredMatrixPath -Right $script:PriorPath)
            ) 'Matrix outer PATH restoration was not exact'
            $script:PathRestored = $true
        }
        catch {
            $script:LifecycleCleanupErrors.Add($_)
        }
    }
    $generatedCleanup = Invoke-GeneratedOutputCleanup -RepositoryRoot $script:RepositoryRoot -WebRoot $script:WebRoot -ContractsRoot $script:ContractsRoot
}

$allCleanupFailures = @($script:LifecycleCleanupErrors) + @($generatedCleanup.Errors)
if ($null -ne $primaryFailure -or $allCleanupFailures.Count -ne 0) {
    [System.Console]::Error.WriteLine(
        (New-AggregatedFailureText -PrimaryFailure $primaryFailure -CleanupFailures $allCleanupFailures)
    )
    if (
        $null -ne $primaryFailure -and
        $primaryFailure.Exception -is [NativeCommandFailureException]
    ) {
        exit $primaryFailure.Exception.NativeExitCode
    }
    exit 1
}

$statusResult = Invoke-NativeChecked -Label 'repository.status.ignored-aware' -Executable $tools.git -Arguments @(
    'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'
) -WorkingDirectory $script:RepositoryRoot
Assert-ZeroRawOutput -Result $statusResult

Write-Output 'IGNORED_AWARE_REPOSITORY_STATUS=EMPTY'
Write-Output "PHASE0_MATRIX_PASS|commands=$($script:ToolCommandLabels.Count + $script:MatrixCommandLabels.Count)|tool_labels=$($script:ToolCommandLabels.Count)|matrix_labels=$($script:MatrixCommandLabels.Count)|production_completion=0|release=NO-GO"
