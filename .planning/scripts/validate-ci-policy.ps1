[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$mandatoryFiles = @(
    (Join-Path $repoRoot '.github\workflows\ci.yml'),
    (Join-Path $repoRoot '.github\workflows\deploy.yml'),
    (Join-Path $repoRoot 'Makefile')
)

$combined = ($mandatoryFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"
foreach ($forbidden in @(
    '\|\|\s*true',
    '(?<![A-Za-z])-no-fail(?![A-Za-z])',
    'continue-on-error:\s*true',
    'fail_ci_if_error:\s*false'
)) {
    if ($combined -match $forbidden) {
        throw "mandatory delivery path contains fail-open pattern: $forbidden"
    }
}

$ci = Get-Content -LiteralPath (Join-Path $repoRoot '.github\workflows\ci.yml') -Raw
foreach ($required in @(
    'go test -race',
    'npm test --prefix apps/web -- --run',
    'npm run build --prefix apps/web',
    'npm test --prefix contracts',
    'npm ci --ignore-scripts --prefix contracts',
    'npm run test:preflight --prefix contracts',
    'npm run compile --prefix contracts',
    'npm run typecheck --prefix contracts',
    'gosec -tests',
    'go install golang.org/x/vuln/cmd/govulncheck@v1.6.0',
    'govulncheck ./cmd/... ./internal/... ./scripts/...',
    'npm audit --prefix apps/web --audit-level=moderate',
    'npm audit --prefix contracts --audit-level=moderate',
    'validate-repository-artifacts.ps1',
    'validate-production-compose.ps1',
    'Clean and current-schema migration smoke tests',
    'needs: [planning, go, migrations, web, contracts, security]'
)) {
    if (-not $ci.Contains($required)) {
        throw "CI is missing mandatory gate: $required"
    }
}

if ([regex]::Matches($ci, [regex]::Escape('go run ./cmd/migrate')).Count -lt 2) {
    throw 'CI must exercise migrations against both a clean and current schema'
}

$contractSequence = @(
    'npm ci --ignore-scripts --prefix contracts',
    'npm run test:preflight --prefix contracts',
    'npm run compile --prefix contracts',
    'npm run typecheck --prefix contracts',
    'npm test --prefix contracts'
)
$previousContractStep = -1
foreach ($contractStep in $contractSequence) {
    $contractStepIndex = $ci.IndexOf($contractStep, [System.StringComparison]::Ordinal)
    if ($contractStepIndex -le $previousContractStep) {
        throw "contract CI steps are missing or out of order at: $contractStep"
    }
    $previousContractStep = $contractStepIndex
}

$apiDockerfile = Get-Content -LiteralPath (Join-Path $repoRoot 'Dockerfile.api') -Raw
if ($apiDockerfile -notmatch '(?m)^COPY --chown=appuser:appuser migrations /home/appuser/migrations\s*$') {
    throw 'Dockerfile.api must copy migrations into the runtime image used by the migrate entrypoint'
}

$dockerignore = Get-Content -LiteralPath (Join-Path $repoRoot '.dockerignore') -Raw
foreach ($requiredIgnore in @(
    '**/.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*.zip',
    '**/*.tar',
    '**/*.gz',
    '**/*.tgz',
    '**/*.bz2',
    '**/*.xz',
    '**/*.exe',
    '**/*.dll',
    '**/*.log'
)) {
    if (-not $dockerignore.Contains($requiredIgnore)) {
        throw "Docker build context does not exclude prohibited material: $requiredIgnore"
    }
}

$deploy = Get-Content -LiteralPath (Join-Path $repoRoot '.github\workflows\deploy.yml') -Raw
if ($deploy -notmatch '(?m)^\s*exit 1\s*$' -or $deploy -notmatch 'intentionally blocked') {
    throw 'deployment workflow must explicitly fail until real deployment controls exist'
}
if ($deploy -match '(?i)successfully deployed|notify deployment success') {
    throw 'blocked deployment workflow must not publish success evidence'
}

$makefile = Get-Content -LiteralPath (Join-Path $repoRoot 'Makefile') -Raw
if ($makefile -notmatch '(?ms)^rollback:.*?^\s*@exit 1\s*$') {
    throw 'rollback command must explicitly fail until a verified recovery procedure exists'
}

Write-Host 'CI policy valid: mandatory checks propagate failure and deployment remains explicitly blocked.'
