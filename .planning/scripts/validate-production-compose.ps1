[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$composeFile = Join-Path $repoRoot 'docker-compose.prod.yml'
$fixtureFile = Join-Path $repoRoot 'config\production.env.example'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'docker is required to validate the production Compose contract'
}

Push-Location $repoRoot
try {
    & docker compose --env-file $fixtureFile -f $composeFile config --quiet
    if ($LASTEXITCODE -ne 0) {
        throw 'production Compose did not render with the non-secret validation fixture'
    }

    $services = @(& docker compose --env-file $fixtureFile -f $composeFile config --services)
    if ($LASTEXITCODE -ne 0) {
        throw 'could not enumerate production Compose services'
    }
    foreach ($forbiddenService in @('postgres', 'redis', 'nats', 'minio', 'minio-init')) {
        if ($services -contains $forbiddenService) {
            throw "production Compose must not host or publish data service '$forbiddenService'"
        }
    }

    $rendered = (& docker compose --env-file $fixtureFile -f $composeFile config) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw 'could not render production Compose for policy inspection'
    }

    foreach ($pattern in @(
        'CHAIN_PRIVATE_KEY',
        '(?im)^\s*AUTH_MODE:\s*dev\s*$',
        '(?im)^\s*CHAIN_MODE:\s*mock\s*$',
        '(?im)^\s*ENABLE_MARKETPLACE:\s*["'']?true["'']?\s*$',
        'minioadmin',
        'anonymous\s+set',
        'sslmode=disable'
    )) {
        if ($rendered -match $pattern) {
            throw "production Compose rendered forbidden pattern: $pattern"
        }
    }

    $renderedJSON = (& docker compose --env-file $fixtureFile -f $composeFile config --format json) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw 'could not render production Compose JSON for least-privilege inspection'
    }
    $renderedConfig = $renderedJSON | ConvertFrom-Json
    $workerVariables = @($renderedConfig.services.worker.environment.PSObject.Properties.Name | Sort-Object)
    $expectedWorkerVariables = @('APP_ENV', 'DATABASE_URL', 'NATS_URL')
    $workerDifference = @(Compare-Object -ReferenceObject $expectedWorkerVariables -DifferenceObject $workerVariables)
    if ($workerDifference.Count -ne 0) {
        throw "production worker environment must contain only APP_ENV, DATABASE_URL and NATS_URL; found: $($workerVariables -join ', ')"
    }

    $composeText = Get-Content -LiteralPath $composeFile -Raw
    $requiredVariables = [regex]::Matches($composeText, '\$\{([A-Z0-9_]+):\?') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique
    $fixtureLines = Get-Content -LiteralPath $fixtureFile

    foreach ($variable in $requiredVariables) {
        $tempFile = [System.IO.Path]::GetTempFileName()
        try {
            $fixtureLines |
                Where-Object { $_ -notmatch "^$([regex]::Escape($variable))=" } |
                Set-Content -LiteralPath $tempFile

            & docker compose --env-file $tempFile -f $composeFile config --quiet *> $null
            if ($LASTEXITCODE -eq 0) {
                throw "production Compose rendered without required variable $variable"
            }
        }
        finally {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "Production Compose contract valid: $($services -join ', '); $($requiredVariables.Count) required variables fail closed."
}
finally {
    Pop-Location
}
