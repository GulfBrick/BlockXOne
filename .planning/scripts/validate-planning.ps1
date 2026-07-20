[CmdletBinding()]
param(
    [string]$GsdToolsPath = (Join-Path $env:USERPROFILE '.codex\get-shit-done\bin\gsd-tools.cjs')
)

$ErrorActionPreference = 'Stop'

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$validatorRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Assert-Condition (Test-Path -LiteralPath $GsdToolsPath) "GSD tools not found: $GsdToolsPath"

Push-Location $validatorRepoRoot
try {
    $initRaw = & node $GsdToolsPath init milestone-op
    Assert-Condition ($LASTEXITCODE -eq 0) 'GSD milestone initialization failed'
    $init = ($initRaw -join "`n") | ConvertFrom-Json

    Assert-Condition ($init.milestone_version -eq 'v2.0') "Expected milestone v2.0, got $($init.milestone_version)"
    Assert-Condition ($init.milestone_name -eq 'Production-Ready Rebuild') "Unexpected milestone name: $($init.milestone_name)"
    Assert-Condition ([int]$init.phase_count -eq 12) "Expected 12 phase directories, got $($init.phase_count)"
    Assert-Condition ([int]$init.completed_phases -eq 0) "Expected zero completed phases, got $($init.completed_phases)"
    Assert-Condition ([bool]$init.commit_docs) 'Planning/evidence versioning must be enabled'

    $roadmapRaw = & node $GsdToolsPath roadmap analyze
    Assert-Condition ($LASTEXITCODE -eq 0) 'GSD roadmap analysis failed'
    $roadmap = ($roadmapRaw -join "`n") | ConvertFrom-Json

    Assert-Condition ([int]$roadmap.phase_count -eq 12) "Expected 12 roadmap phases, got $($roadmap.phase_count)"
    Assert-Condition ([int]$roadmap.completed_phases -eq 0) "Expected zero completed roadmap phases, got $($roadmap.completed_phases)"
    Assert-Condition ([int]$roadmap.progress_percent -eq 0) "Expected zero production progress, got $($roadmap.progress_percent)%"
    Assert-Condition ([string]$roadmap.current_phase -eq '0') "Expected current phase 0, got $($roadmap.current_phase)"

    $expectedDependencies = @{
        '0' = 'Nothing'
        '1' = 'Phase 0'
        '2' = 'Phase 1'
        '3' = 'Phase 2'
        '4' = 'Phase 2'
        '5' = 'Phases 3 and 4'
        '6' = 'Phases 3, 4 and 5'
        '7' = 'Phases 2 and 6'
        '8' = 'Phases 3, 4, 5 and 6'
        '9' = 'Phases 7 and 8'
        '10' = 'Phase 9'
        '11' = 'Phase 10'
    }

    foreach ($phase in $roadmap.phases) {
        $phaseNumber = [string]$phase.number
        Assert-Condition $expectedDependencies.ContainsKey($phaseNumber) "Unexpected phase number: $phaseNumber"
        Assert-Condition ([string]$phase.depends_on -eq $expectedDependencies[$phaseNumber]) "Phase $phaseNumber dependency mismatch: $($phase.depends_on)"
    }

    $requirementsText = Get-Content -Raw '.planning\REQUIREMENTS.md'
    $requirementMatches = [regex]::Matches($requirementsText, '(?m)^- \[ \] \*\*([A-Z]+-[0-9]{2}):\*\*')
    $requirementIds = @($requirementMatches | ForEach-Object { $_.Groups[1].Value })
    $uniqueRequirementIds = @($requirementIds | Sort-Object -Unique)
    $duplicateRequirementIds = @($requirementIds | Group-Object | Where-Object Count -gt 1)

    Assert-Condition ($requirementIds.Count -eq 89) "Expected 89 active requirement occurrences, got $($requirementIds.Count)"
    Assert-Condition ($uniqueRequirementIds.Count -eq 89) "Expected 89 unique active requirements, got $($uniqueRequirementIds.Count)"
    Assert-Condition ($duplicateRequirementIds.Count -eq 0) "Duplicate active requirements: $($duplicateRequirementIds.Name -join ', ')"

    $healthRaw = & node $GsdToolsPath validate health
    Assert-Condition ($LASTEXITCODE -eq 0) 'GSD health command failed'
    $health = ($healthRaw -join "`n") | ConvertFrom-Json
    Assert-Condition ($health.status -eq 'healthy') "Expected healthy planning state, got $($health.status)"
    Assert-Condition ($health.errors.Count -eq 0) "Planning health errors: $($health.errors.message -join '; ')"
    Assert-Condition ($health.warnings.Count -eq 0) "Planning health warnings: $($health.warnings.message -join '; ')"

    Write-Output 'PLANNING_VALIDATION=PASS'
    Write-Output 'MILESTONE=v2.0 Production-Ready Rebuild'
    Write-Output 'PHASES=12'
    Write-Output 'PROGRESS=0%'
    Write-Output 'ACTIVE_REQUIREMENTS=89'
}
finally {
    Pop-Location
}
