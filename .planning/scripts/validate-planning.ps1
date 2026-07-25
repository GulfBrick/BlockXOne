[CmdletBinding()]
param(
    [ValidateSet('BuilderStaged', 'CleanCandidate')]
    [string]$ResidueMode = 'CleanCandidate',
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$acceptedPlanHash = '5443CA4DB90D005DBA6C7AD12060D2A19F039D78FE42F4F4D2BA8D21213CD53D'
$publishedR01BaselineRule = '- **Published R-01 baseline:** `d4f3ccc442871c590cc39ec7967e0bca53739739` on `codex/functional-platform`.'
$acceptedPlanSnapshotRule = '- **Accepted-plan evidence snapshot:** The R-01 line `GitHub publication: pending` in the accepted checkpoint plan is its pre-execution snapshot; EV-P0-060 and this STATE supersede only that status line. The accepted scope, constraints, acceptance criteria and plan hash remain authoritative.'
$currentCheckpointR01Rule = '- **R-01:** published baseline `d4f3ccc442871c590cc39ec7967e0bca53739739`; GitHub `main` remains `df3e1698f28891e7d23489a144eae2733bc8b79d`.'

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-OrdinalSetEqual {
    param(
        [string[]]$Actual,
        [string[]]$Expected,
        [string]$Label
    )

    $actualSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($value in $Actual) {
        Assert-Condition ($actualSet.Add($value)) "$Label contains duplicate value '$value'"
    }
    $expectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($value in $Expected) {
        Assert-Condition ($expectedSet.Add($value)) "validator contains duplicate expected $Label '$value'"
    }
    $missing = @($Expected | Where-Object { -not $actualSet.Contains($_) })
    $extra = @($Actual | Where-Object { -not $expectedSet.Contains($_) })
    Assert-Condition (
        $missing.Count -eq 0 -and $extra.Count -eq 0
    ) "$Label mismatch; missing=[$($missing -join ', ')]; extra=[$($extra -join ', ')]"
}

function Assert-ExactlyOneCanonicalLine {
    param(
        [string]$Text,
        [string]$CanonicalLine,
        [string]$Label
    )

    $matches = @(
        $Text -split '\r?\n' |
            Where-Object { $_ -ceq $CanonicalLine }
    )
    Assert-Condition (
        $matches.Count -eq 1
    ) "$Label must appear exactly once as the canonical line; found $($matches.Count)"
}

function Get-MarkdownTableRows {
    param([string]$Text)

    $rows = [Collections.Generic.List[object]]::new()
    foreach ($line in ($Text -split '\r?\n')) {
        $trimmed = $line.Trim()
        if (-not $trimmed.StartsWith('|', [StringComparison]::Ordinal) -or
            -not $trimmed.EndsWith('|', [StringComparison]::Ordinal)) {
            continue
        }

        $cells = @(
            $trimmed.Trim('|') -split '\|' |
                ForEach-Object { $_.Trim() }
        )
        [void]$rows.Add(
            [pscustomobject]@{
                Cells = $cells
                Raw = $line
            }
        )
    }

    return @($rows)
}

function Test-CanonicalHistoricalHeadingTitle {
    param([string]$Title)

    return @(
        'Historical lineage position — non-authoritative',
        'Historical controlled-loop decisions — non-authoritative',
        'Historical Phase 0/Generation 2/Generation 3 evidence — non-authoritative',
        'Historical Generation 2/Generation 3 blocker detail — non-authoritative',
        'Historical disposition',
        'Historical Generation 3 next actions — non-authoritative; do not execute',
        'Historical Plan 00-12 truth boundary — non-authoritative'
    ) -ccontains $Title.Trim()
}

function Get-NonHistoricalPlanningLines {
    param([string]$Text)

    $lines = [Collections.Generic.List[string]]::new()
    $sectionHistory = @{}
    foreach ($line in ($Text -split '\r?\n')) {
        if ($line -match '^(?<marks>#{1,6})\s+(?<title>.+?)\s*$') {
            $level = $Matches.marks.Length
            foreach ($existingLevel in @($sectionHistory.Keys)) {
                if ([int]$existingLevel -ge $level) {
                    $sectionHistory.Remove($existingLevel)
                }
            }
            $parentIsHistorical = @(
                $sectionHistory.Values |
                    Where-Object { [bool]$_ }
            ).Count -gt 0
            $sectionHistory[$level] = (
                $parentIsHistorical -or
                (Test-CanonicalHistoricalHeadingTitle -Title $Matches.title)
            )
        }

        $isHistorical = @(
            $sectionHistory.Values |
                Where-Object { [bool]$_ }
        ).Count -gt 0
        if (-not $isHistorical) {
            [void]$lines.Add($line)
        }
    }
    return @($lines)
}

function Assert-ExactCurrentAuthorityDeclarations {
    param(
        [string]$DocumentName,
        [string]$Text,
        [string[]]$Expected
    )

    $currentLines = @(Get-NonHistoricalPlanningLines -Text $Text)
    $actual = @(
        $currentLines |
            Where-Object {
                $line = $_
                if ($line -match '(?i)^\s*[-*]?\s*\*\*historical\b') {
                    return $false
                }
                $startsWithAuthority = (
                    $line -match '(?i)^\s*(?:[-*#>]+\s*)?(?:\*\*)?(?:active|current(?:ly)?|authoritative|delivery|execution|release)\b'
                )
                $hasCurrentContext = (
                    $line -match '(?i)\b(?:active|current(?:ly)?|authoritative)\b'
                )
                $hasAuthoritySubject = (
                    $line -match '(?i)\b(?:delivery|execution|release|production|repository|branch|gate|G(?:1|2|3|5))\b'
                )
                $isStructuredDeclaration = (
                    $line -match '^\s*(?:[-*]\s*)?(?:#{1,6}\s+|\*\*[^*]+:\*\*)'
                )
                $isBoldDeclaration = (
                    $line -match '^\s*(?:[-*]\s*)?\*\*[^*]+:\*\*'
                )
                $subjectStartsLine = (
                    $line -match '(?i)^\s*(?:[-*#>]+\s*)?(?:\*\*)?(?:delivery|execution|release|production|repository|branch|gate|G(?:1|2|3|5))\b'
                )
                $hasProfessionalGateSubject = (
                    $line -match '(?i)\b(?:G(?:1|2|3|5)|professional\s+gate)\b'
                )
                $hasReleaseSubject = (
                    $line -match '(?i)\b(?:production|release|go[- ]?live|live\s+customers?)\b'
                )
                $hasClosureStatus = (
                    $line -match '(?i)\b(?:approved|authori[sz]ed|cleared|passed|closed|complete(?:d)?|ready|enabled|signed[ -]?off)\b'
                )
                $hasFailClosedQualifier = (
                    $line -match '(?i)\bNO-GO\b|\b(?:not|never|pending|blocked|ineligible)\b|fail[- ]closed|only\s+(?:after|when|through)|\b(?:until|before)\b|\b(?:cannot|does\s+not|must\s+not)\b'
                )
                $conflictingStatusDeclaration = (
                    ($hasProfessionalGateSubject -or $hasReleaseSubject) -and
                    $hasClosureStatus -and
                    -not $hasFailClosedQualifier
                )
                $conflictingCurrentAuthority = (
                    $hasCurrentContext -and
                    $hasAuthoritySubject -and
                    -not $hasFailClosedQualifier
                )
                $startsWithAuthority -or
                    $conflictingCurrentAuthority -or
                    $conflictingStatusDeclaration
            }
    )
    Assert-OrdinalSetEqual `
        -Actual $actual `
        -Expected $Expected `
        -Label "$DocumentName nonhistorical current-authority declarations"
}

function Assert-PlanningDocuments {
    param(
        [hashtable]$Documents,
        [string]$PlanHash
    )

    Assert-Condition (
        $PlanHash -ceq $acceptedPlanHash
    ) "checkpointed delivery plan hash mismatch: $PlanHash"

    foreach ($requiredPlanLine in @(
        '**Delivery repository:** `work/blockxone-functional`',
        '**Delivery branch:** `codex/functional-platform`',
        '**Release posture:** local demonstration recoverable; production NO-GO'
    )) {
        Assert-ExactlyOneCanonicalLine `
            -Text $Documents.Plan `
            -CanonicalLine $requiredPlanLine `
            -Label "checkpoint plan authority '$requiredPlanLine'"
    }
    Assert-Condition (
        [regex]::Matches(
            $Documents.Plan,
            [regex]::Escape('BlockXOne will be delivered through finite rocks.')
        ).Count -eq 1
    ) 'checkpoint plan delivery contract must appear exactly once'

    $authorityMarkers = @(
        '**Authoritative delivery repository:** `work/blockxone-functional`',
        '**Authoritative delivery branch:** `codex/functional-platform`',
        '**Execution mode:** checkpointed finite rocks',
        '**Release posture:** production NO-GO'
    )
    foreach ($authorityDocument in @('State', 'Roadmap', 'Project')) {
        foreach ($marker in $authorityMarkers) {
            Assert-ExactlyOneCanonicalLine `
                -Text $Documents[$authorityDocument] `
                -CanonicalLine $marker `
                -Label "$authorityDocument current authority marker '$marker'"
        }
    }

    $expectedAuthorityDeclarations = [ordered]@{
        Plan = @(
            '**Delivery repository:** `work/blockxone-functional`',
            '**Delivery branch:** `codex/functional-platform`',
            '**Release posture:** local demonstration recoverable; production NO-GO',
            '## Delivery contract',
            '**Delivery owner:** Codex Integrator',
            'current delivery source, make the planning contract truthful, and obtain one',
            'The GitHub repository becomes the local remote named `origin`. The current',
            '- active branch upstream: `origin/codex/functional-platform`.',
            '- current recovery documentation and receipts;',
            '### Current evidence',
            '### Authoritative design inputs',
            '### Release rule'
        )
        State = @(
            'milestone_name: production-ready rebuild',
            '# BlockXOne Production-Ready Rebuild State',
            'Current execution contract: `.planning/CHECKPOINTED-DELIVERY-PLAN.md`',
            '**Current focus:** P0-A — authoritative planning truth and exact clean-candidate hosted CI admission.',
            '## Current delivery authority',
            '**Authoritative delivery repository:** `work/blockxone-functional`',
            '**Authoritative delivery branch:** `codex/functional-platform`',
            '**Execution mode:** checkpointed finite rocks',
            '**Release posture:** production NO-GO',
            '- **Current P0-A gate:** one exact candidate must produce a named hosted `CI` run with nonzero mandatory jobs and overall `success`; no such success receipt is recorded yet.',
            '- **Current dependency gate:** mandatory web and contract audits fail closed on high-severity `GHSA-mh99-v99m-4gvg` (`brace-expansion <=5.0.7`; patched release `5.0.8`). No audit threshold is lowered. Package remediation requires a separately accepted narrow scope because package and lock files are outside P0-A.',
            '## Current blockers and no-go conditions',
            '## Current next actions',
            '## Current session checkpoint — 2026-07-25',
            '- **Current repository:** `C:\Users\danie\Documents\BlockXOne Test\work\blockxone-functional`.',
            '- **Current branch:** `codex/functional-platform`.',
            '- **Release posture detail:** local demonstration is recoverable; production remains NO-GO until mandatory technical, financial, security, compliance, operational and external professional gates close.',
            '- **Release posture:** This is a recoverable UI checkpoint, not a staging or production release. Production remains NO-GO.'
        )
        Roadmap = @(
            '# BlockXOne Production-Ready Rebuild Roadmap',
            '## Current delivery authority',
            '**Authoritative delivery repository:** `work/blockxone-functional`',
            '**Authoritative delivery branch:** `codex/functional-platform`',
            '**Execution mode:** checkpointed finite rocks',
            '**Release posture:** production NO-GO',
            '- **Execution contract:** `.planning/CHECKPOINTED-DELIVERY-PLAN.md`, accepted SHA-256 `5443CA4DB90D005DBA6C7AD12060D2A19F039D78FE42F4F4D2BA8D21213CD53D`.',
            '## Current checkpoint sequence',
            '2. Production starts with approved customer, value, asset, currency, chain and provider limits.'
        )
        Project = @(
            '# BlockXOne Production-Ready Rebuild',
            '## Current delivery authority',
            '**Authoritative delivery repository:** `work/blockxone-functional`',
            '**Authoritative delivery branch:** `codex/functional-platform`',
            '**Execution mode:** checkpointed finite rocks',
            '**Release posture:** production NO-GO',
            '- **Execution contract:** `.planning/CHECKPOINTED-DELIVERY-PLAN.md`, accepted SHA-256 `5443CA4DB90D005DBA6C7AD12060D2A19F039D78FE42F4F4D2BA8D21213CD53D`.',
            '- **Current delivery sequence:** P0-A clean-candidate admission, R-02 completion, R-03 workflow closure, R-04 protected staging, then R-05 production release gates.',
            '2. `.planning/CHECKPOINTED-DELIVERY-PLAN.md` for current delivery scope, branch, rock and stop conditions.',
            '3. Production master plan and active requirements for the downstream production-control perimeter.',
            '## Execution model'
        )
    }
    foreach ($authorityDocument in $expectedAuthorityDeclarations.Keys) {
        Assert-ExactCurrentAuthorityDeclarations `
            -DocumentName $authorityDocument `
            -Text $Documents[$authorityDocument] `
            -Expected $expectedAuthorityDeclarations[$authorityDocument]
    }

    Assert-Condition (
        $Documents.Decisions.Contains(
            'Superseded 2026-07-25 by checkpointed finite-rock delivery'
        )
    ) 'DEC-001 must be explicitly superseded'
    Assert-Condition (
        $Documents.Approvals.Contains(
            'Superseded 2026-07-25; historical only'
        )
    ) 'the prior controlled-loop approval must be explicitly superseded'
    Assert-Condition (
        $Documents.Loop.Contains('SUPERSEDED / HISTORICAL — DO NOT EXECUTE')
    ) 'the retired loop document is missing its historical-only banner'

    foreach ($planningDefault in @(
        'South African private debt',
        'ZAR',
        'AWS af-south-1',
        'Polygon PoS mainnet (chain 137) and Amoy testnet',
        'PostgreSQL-native durable workflow',
        'no client-fund or client-asset custody',
        'No secondary market in release one',
        'T-REX 4.1.3',
        'proprietary licence'
    )) {
        Assert-Condition (
            $Documents.Decisions.Contains($planningDefault)
        ) "decision register is missing accepted planning default: $planningDefault"
    }

    $approvalRows = @(Get-MarkdownTableRows -Text $Documents.Approvals)
    $pendingGates = [ordered]@{
        G1 = 'G1 permitted perimeter'
        G2 = 'G2 identity/tenancy'
        G3 = 'G3 financial integrity'
        G5 = 'G5 blockchain candidate'
    }
    foreach ($gateEntry in $pendingGates.GetEnumerator()) {
        $gateRows = @(
            $approvalRows |
                Where-Object {
                    $_.Cells.Count -gt 0 -and
                    $_.Cells[0] -match "^$([regex]::Escape($gateEntry.Key))(?:\s|$)"
                }
        )
        Assert-Condition (
            $gateRows.Count -eq 1
        ) "professional gate must have exactly one current approval row: $($gateEntry.Key)"

        $gateRow = $gateRows[0]
        Assert-Condition (
            $gateRow.Cells.Count -eq 4
        ) "professional gate row must contain exactly four cells: $($gateEntry.Key)"
        Assert-Condition (
            $gateRow.Cells[0] -ceq $gateEntry.Value
        ) "professional gate row must use the canonical identity: $($gateEntry.Value)"
        Assert-Condition (
            $gateRow.Cells[2] -ceq 'Pending'
        ) "professional gate must remain exactly Pending: $($gateEntry.Value)"
    }

    Assert-Condition (
        $Documents.State.Contains('d4f3ccc442871c590cc39ec7967e0bca53739739')
    ) 'STATE must record the exact published R-01 baseline'
    Assert-Condition (
        $Documents.State.Contains($acceptedPlanSnapshotRule)
    ) 'STATE must explicitly supersede the accepted plan pre-execution R-01 publication snapshot'
    $nonHistoricalR01PublicationLines = @(
        Get-NonHistoricalPlanningLines -Text $Documents.State |
            Where-Object {
                $_ -match '(?i)\bR-01\b' -and
                $_ -match '(?i)\b(?:publication|published)\b'
            }
    )
    Assert-OrdinalSetEqual `
        -Actual $nonHistoricalR01PublicationLines `
        -Expected @(
            $publishedR01BaselineRule,
            $acceptedPlanSnapshotRule,
            $currentCheckpointR01Rule
        ) `
        -Label 'STATE nonhistorical R-01 publication-status declarations'
    Assert-Condition (
        $Documents.State.Contains('R-02 remains in progress')
    ) 'STATE must state that R-02 remains in progress'
    Assert-Condition (
        $Documents.State.Contains('df3e1698f28891e7d23489a144eae2733bc8b79d')
    ) 'STATE must freeze the unchanged GitHub main SHA'

    foreach ($stateContract in @(
        '(?m)^[ \t]*current_phase:\s*0 of 12\b',
        '(?m)^[ \t]*status:\s*in_progress[ \t]*$',
        '(?m)^[ \t]*total_phases:\s*12[ \t]*$',
        '(?m)^[ \t]*completed_phases:\s*0[ \t]*$'
    )) {
        Assert-Condition (
            [regex]::IsMatch($Documents.State, $stateContract)
        ) "STATE frontmatter invariant failed: $stateContract"
    }

    $phaseMatches = [regex]::Matches(
        $Documents.Roadmap,
        '(?m)^- \[(?<mark>[ xX])\] \*\*Phase (?<number>[0-9]+):'
    )
    Assert-Condition (
        $phaseMatches.Count -eq 12
    ) "ROADMAP must contain exactly 12 phase checklist entries; found $($phaseMatches.Count)"
    $phaseNumbers = @($phaseMatches | ForEach-Object { $_.Groups['number'].Value })
    Assert-OrdinalSetEqual $phaseNumbers @(0..11 | ForEach-Object { [string]$_ }) 'ROADMAP phase numbers'
    $checkedPhases = @(
        $phaseMatches | Where-Object { $_.Groups['mark'].Value -cne ' ' }
    )
    Assert-Condition (
        $checkedPhases.Count -eq 0
    ) 'ROADMAP must retain authoritative production progress at 0/12'

    $declaredRequirementMatches = [regex]::Matches(
        $Documents.Requirements,
        '(?m)^\*\*Active requirements:\*\*\s*(?<count>[0-9]+)\s*$'
    )
    Assert-Condition (
        $declaredRequirementMatches.Count -eq 1 -and
        [int]$declaredRequirementMatches[0].Groups['count'].Value -eq 89
    ) 'REQUIREMENTS must declare exactly 89 active requirements'
    $requirementMatches = [regex]::Matches(
        $Documents.Requirements,
        '(?m)^- \[(?<mark>[ xX])\] \*\*(?<id>[A-Z]+-[0-9]{2}):\*\*'
    )
    Assert-Condition (
        $requirementMatches.Count -eq 89
    ) "expected 89 active requirement entries; found $($requirementMatches.Count)"
    $checkedRequirements = @(
        $requirementMatches | Where-Object { $_.Groups['mark'].Value -cne ' ' }
    )
    Assert-Condition (
        $checkedRequirements.Count -eq 0
    ) 'all 89 active requirements must remain unchecked'
}

function Copy-DocumentMap {
    param([hashtable]$Documents)

    $copy = @{}
    foreach ($key in $Documents.Keys) {
        $copy[$key] = $Documents[$key]
    }
    return $copy
}

function Assert-TextMutationRejected {
    param(
        [hashtable]$Documents,
        [string]$PlanHash,
        [string]$Key,
        [string]$OldText,
        [string]$NewText,
        [string]$Label
    )

    Assert-Condition (
        $Documents[$Key].Contains($OldText)
    ) "self-test fixture is missing mutation source for $Label"
    $mutated = Copy-DocumentMap $Documents
    $mutated[$Key] = $mutated[$Key].Replace($OldText, $NewText)
    $rejected = $false
    try {
        Assert-PlanningDocuments -Documents $mutated -PlanHash $PlanHash
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected "self-test mutation was not rejected: $Label"
}

function Assert-AppendedTextRejected {
    param(
        [hashtable]$Documents,
        [string]$PlanHash,
        [string]$Key,
        [string]$AppendedText,
        [string]$Label
    )

    $mutated = Copy-DocumentMap $Documents
    $mutated[$Key] += [Environment]::NewLine + $AppendedText
    $rejected = $false
    try {
        Assert-PlanningDocuments -Documents $mutated -PlanHash $PlanHash
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected "self-test appended mutation was not rejected: $Label"
}

function Assert-CurrentTextRejected {
    param(
        [hashtable]$Documents,
        [string]$PlanHash,
        [string]$Key,
        [string]$InsertedText,
        [string]$Label
    )

    $mutated = Copy-DocumentMap $Documents
    $historicalHeading = $null
    foreach ($headingMatch in [regex]::Matches(
        $mutated[$Key],
        '(?m)^#{1,6}\s+(?<title>.+?)\s*$'
    )) {
        if (Test-CanonicalHistoricalHeadingTitle -Title $headingMatch.Groups['title'].Value) {
            $historicalHeading = $headingMatch
            break
        }
    }
    if ($null -ne $historicalHeading) {
        $mutated[$Key] = $mutated[$Key].Insert(
            $historicalHeading.Index,
            $InsertedText + [Environment]::NewLine + [Environment]::NewLine
        )
    }
    else {
        $mutated[$Key] += [Environment]::NewLine + $InsertedText
    }

    $rejected = $false
    try {
        Assert-PlanningDocuments -Documents $mutated -PlanHash $PlanHash
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected "self-test current-section mutation was not rejected: $Label"
}

function Assert-PlanHashMutationRejected {
    param([hashtable]$Documents)

    $rejected = $false
    try {
        Assert-PlanningDocuments -Documents $Documents -PlanHash ('0' * 64)
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected 'self-test wrong plan hash was not rejected'
}

function Assert-RepositoryResidue {
    param([string]$Mode)

    Push-Location $repoRoot
    try {
        $status = @(git status --porcelain=v1 --untracked-files=all --ignored=matching)
        Assert-Condition ($LASTEXITCODE -eq 0) 'ignored-aware repository status command failed'
    }
    finally {
        Pop-Location
    }

    if ($Mode -ceq 'CleanCandidate') {
        Assert-Condition (
            $status.Count -eq 0
        ) "CleanCandidate requires empty ignored-aware status; found=[$($status -join '; ')]"
        return
    }

    $allowedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($path in @(
        '.planning/CHECKPOINTED-DELIVERY-PLAN.md',
        '.planning/STATE.md',
        '.planning/ROADMAP.md',
        '.planning/PROJECT.md',
        '.planning/DECISIONS.md',
        '.planning/APPROVALS.md',
        '.planning/BLOCKERS.md',
        '.planning/EVIDENCE-REGISTER.md',
        '.planning/scripts/validate-planning.ps1',
        '.planning/scripts/validate-ci-policy.ps1',
        '.planning/scripts/verify-p0a-hosted.ps1',
        '.github/workflows/ci.yml',
        '.github/CODEOWNERS',
        '.github/dependabot.yml',
        'docs/BLOCKXONE_AGENT_EXECUTION_LOOP.md',
        'docs/BLOCKXONE_PRODUCTION_MASTER_PLAN.md'
    )) {
        [void]$allowedPaths.Add($path)
    }

    foreach ($line in $status) {
        Assert-Condition (
            -not $line.StartsWith('?? ', [StringComparison]::Ordinal)
        ) "BuilderStaged forbids untracked residue: $line"
        Assert-Condition (
            -not $line.StartsWith('!! ', [StringComparison]::Ordinal)
        ) "BuilderStaged forbids ignored residue: $line"
        Assert-Condition (
            $line.Length -ge 4 -and $line[2] -ceq ' '
        ) "BuilderStaged cannot parse repository status: $line"
        $path = $line.Substring(3).Replace('\', '/')
        Assert-Condition (
            $allowedPaths.Contains($path)
        ) "BuilderStaged forbids tracked path: $path"
    }
}

$documentPaths = [ordered]@{
    Plan = '.planning\CHECKPOINTED-DELIVERY-PLAN.md'
    State = '.planning\STATE.md'
    Roadmap = '.planning\ROADMAP.md'
    Project = '.planning\PROJECT.md'
    Decisions = '.planning\DECISIONS.md'
    Approvals = '.planning\APPROVALS.md'
    Loop = 'docs\BLOCKXONE_AGENT_EXECUTION_LOOP.md'
    Requirements = '.planning\REQUIREMENTS.md'
}
$documents = @{}
foreach ($entry in $documentPaths.GetEnumerator()) {
    $fullPath = Join-Path $repoRoot $entry.Value
    Assert-Condition (Test-Path -LiteralPath $fullPath -PathType Leaf) "missing planning input: $($entry.Value)"
    $documents[$entry.Key] = Get-Content -LiteralPath $fullPath -Raw
}
$actualPlanHash = (Get-FileHash -LiteralPath (
    Join-Path $repoRoot $documentPaths.Plan
) -Algorithm SHA256).Hash.ToUpperInvariant()

Assert-PlanningDocuments -Documents $documents -PlanHash $actualPlanHash

if ($SelfTest) {
    foreach ($authorityDocument in @('State', 'Roadmap', 'Project')) {
        Assert-TextMutationRejected $documents $actualPlanHash $authorityDocument `
            '**Authoritative delivery repository:** `work/blockxone-functional`' `
            '**Authoritative delivery repository:** `work/another-repository`' `
            "$authorityDocument repository authority"
        Assert-TextMutationRejected $documents $actualPlanHash $authorityDocument `
            '**Authoritative delivery branch:** `codex/functional-platform`' `
            '**Authoritative delivery branch:** `main`' `
            "$authorityDocument branch authority"
        Assert-TextMutationRejected $documents $actualPlanHash $authorityDocument `
            '**Execution mode:** checkpointed finite rocks' `
            '**Execution mode:** controlled autonomous loop' `
            "$authorityDocument execution authority"
        Assert-TextMutationRejected $documents $actualPlanHash $authorityDocument `
            '**Release posture:** production NO-GO' `
            '**Release posture:** production ready' `
            "$authorityDocument release posture"

        foreach ($canonicalMarker in @(
            '**Authoritative delivery repository:** `work/blockxone-functional`',
            '**Authoritative delivery branch:** `codex/functional-platform`',
            '**Execution mode:** checkpointed finite rocks',
            '**Release posture:** production NO-GO'
        )) {
            Assert-AppendedTextRejected `
                -Documents $documents `
                -PlanHash $actualPlanHash `
                -Key $authorityDocument `
                -AppendedText $canonicalMarker `
                -Label "$authorityDocument duplicate canonical marker '$canonicalMarker'"
        }
    }

    Assert-TextMutationRejected $documents $actualPlanHash Plan `
        '**Delivery repository:** `work/blockxone-functional`' `
        '**Delivery repository:** `work/another-repository`' `
        'checkpoint repository authority'
    Assert-TextMutationRejected $documents $actualPlanHash Plan `
        '**Delivery branch:** `codex/functional-platform`' `
        '**Delivery branch:** `main`' `
        'checkpoint branch authority'
    foreach ($canonicalPlanLine in @(
        '**Delivery repository:** `work/blockxone-functional`',
        '**Delivery branch:** `codex/functional-platform`',
        '**Release posture:** local demonstration recoverable; production NO-GO',
        'BlockXOne will be delivered through finite rocks.'
    )) {
        Assert-AppendedTextRejected `
            -Documents $documents `
            -PlanHash $actualPlanHash `
            -Key Plan `
            -AppendedText $canonicalPlanLine `
            -Label "checkpoint plan duplicate canonical line '$canonicalPlanLine'"
    }
    Assert-TextMutationRejected $documents $actualPlanHash Decisions `
        'Superseded 2026-07-25 by checkpointed finite-rock delivery' `
        'Approved by user' `
        'DEC-001 supersession'
    Assert-TextMutationRejected $documents $actualPlanHash Approvals `
        'Superseded 2026-07-25; historical only' `
        'Approved' `
        'loop approval supersession'
    Assert-TextMutationRejected $documents $actualPlanHash Loop `
        'SUPERSEDED / HISTORICAL — DO NOT EXECUTE' `
        'ACTIVE EXECUTION PROCEDURE' `
        'historical loop banner'
    Assert-TextMutationRejected $documents $actualPlanHash State `
        'R-02 remains in progress' `
        'R-02 is complete' `
        'R-02 current state'
    Assert-TextMutationRejected $documents $actualPlanHash State `
        $acceptedPlanSnapshotRule `
        '- **Accepted-plan evidence snapshot:** GitHub publication remains pending.' `
        'accepted-plan R-01 evidence snapshot supersession'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        'R-01 GitHub publication remains pending.' `
        'contradictory current R-01 publication status'
    Assert-TextMutationRejected $documents $actualPlanHash Requirements `
        '**Active requirements:** 89' `
        '**Active requirements:** 88' `
        'active requirement count'
    Assert-TextMutationRejected $documents $actualPlanHash Requirements `
        '- [ ] **BASE-01:**' `
        '- [x] **BASE-01:**' `
        'checked requirement'
    Assert-TextMutationRejected $documents $actualPlanHash Roadmap `
        '- [ ] **Phase 0:' `
        '- [x] **Phase 0:' `
        'checked roadmap phase'
    Assert-TextMutationRejected $documents $actualPlanHash Decisions `
        'South African private debt' `
        'unselected product' `
        'accepted product planning default'
    Assert-TextMutationRejected $documents $actualPlanHash Approvals `
        'G3 financial integrity' `
        'G3 financial integrity closed' `
        'financial gate identity'

    Assert-AppendedTextRejected $documents $actualPlanHash State `
        '**Release posture:** production READY' `
        'appended contradictory release posture'
    Assert-AppendedTextRejected $documents $actualPlanHash Project `
        '**Current production status:** GO' `
        'appended current production GO claim'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        '**Authoritative release decision:** approved' `
        'appended authoritative release approval'
    Assert-AppendedTextRejected $documents $actualPlanHash State `
        '**Current financial gate:** G3 closed' `
        'appended current G3 closure'
    Assert-AppendedTextRejected $documents $actualPlanHash Project `
        '**Current blockchain gate:** G5 passed' `
        'appended current G5 pass'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        '**Current production decision:** launch authorized for live customers' `
        'current live-customer launch authorization'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        '**Current G5 decision:** external audit signed off' `
        'current G5 external-audit sign-off'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        '**Current gate status:** closed — G3 financial integrity' `
        'current closed-before-G3 gate claim'
    Assert-CurrentTextRejected $documents $actualPlanHash Project `
        '**Active delivery branch:** main' `
        'conflicting active delivery branch'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        '**Current production decision:** live customers authorized for launch' `
        'reordered current production authorization'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        '**G5 decision (current):** signed off by the external auditor' `
        'reordered current G5 sign-off'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        '**Gate status currently:** closed — G3 financial integrity' `
        'reordered currently closed G3 gate'
    Assert-CurrentTextRejected $documents $actualPlanHash Project `
        '**Branch selected as active:** main' `
        'reordered active branch authority'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        '**G5 decision:** signed off by the external auditor' `
        'implicit-current G5 sign-off declaration'
    Assert-CurrentTextRejected $documents $actualPlanHash Project `
        '**Production decision:** live-customer launch authorized' `
        'implicit-current production authorization declaration'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        '**Gate status:** closed — G3 financial integrity' `
        'implicit-current closed G3 declaration'
    Assert-CurrentTextRejected $documents $actualPlanHash Project `
        'The platform is ready for production.' `
        'plain-prose production-ready claim'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        'Sign-off has closed G3.' `
        'closed-before-G3 plain-prose claim'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        'External auditors signed off G5.' `
        'external-auditor-sign-off-before-G5 claim'
    Assert-CurrentTextRejected $documents $actualPlanHash Project `
        'Main is the active delivery branch.' `
        'main-before-active-delivery-branch claim'
    Assert-CurrentTextRejected $documents $actualPlanHash State `
        'The active repository is BlockXOne Production Gen3.' `
        'active Gen3 repository plain-prose claim'
    Assert-CurrentTextRejected $documents $actualPlanHash Roadmap `
        "## Not historical — current production authority`n**Current production status:** READY" `
        'negated-historical heading cannot hide current production readiness'

    $historicalAuthorityFixture = Copy-DocumentMap $documents
    $historicalAuthorityFixture.Roadmap += [Environment]::NewLine +
        '**Current G5 decision:** historical evidence says an earlier audit signed off; non-authoritative only'
    Assert-PlanningDocuments `
        -Documents $historicalAuthorityFixture `
        -PlanHash $actualPlanHash

    Assert-AppendedTextRejected $documents $actualPlanHash Approvals `
        '| G3 financial integrity | CFO | Approved | synthetic conflict |' `
        'duplicate Approved G3 approval row'
    Assert-AppendedTextRejected $documents $actualPlanHash Approvals `
        '| G1 permitted perimeter | Board delegate | Pending | synthetic duplicate |' `
        'duplicate Pending G1 approval row'
    Assert-AppendedTextRejected $documents $actualPlanHash Approvals `
        '| g2 identity/tenancy | CTO | Pending | noncanonical duplicate |' `
        'case-variant duplicate G2 approval row'

    Assert-PlanHashMutationRejected $documents

    $stale = Copy-DocumentMap $documents
    $stale.State += [Environment]::NewLine +
        '**Current repository:** `C:\Users\danie\Documents\BlockXOne Production Gen3`'
    $rejected = $false
    try {
        Assert-PlanningDocuments -Documents $stale -PlanHash $actualPlanHash
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected 'self-test active Gen3 authority was not rejected'

    Write-Output 'PLANNING_SELF_TEST=PASS'
}
else {
    Assert-RepositoryResidue -Mode $ResidueMode
}

Write-Output 'PLANNING_VALIDATION=PASS'
Write-Output "CHECKPOINT_PLAN_SHA256=$actualPlanHash"
Write-Output 'AUTHORITATIVE_REPOSITORY=work/blockxone-functional'
Write-Output 'AUTHORITATIVE_BRANCH=codex/functional-platform'
Write-Output 'PHASES=12'
Write-Output 'ACTIVE_REQUIREMENTS=89'
Write-Output 'CHECKED_REQUIREMENTS=0'
Write-Output 'RELEASE_POSTURE=production NO-GO'
