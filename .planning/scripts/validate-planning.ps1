[CmdletBinding()]
param(
    [string]$GsdToolsPath = (Join-Path $env:USERPROFILE '.codex\get-shit-done\bin\gsd-tools.cjs'),
    [ValidateSet('BuilderStaged', 'CleanCandidate')]
    [string]$ResidueMode = 'BuilderStaged'
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

function Assert-HasProperty {
    param(
        [object]$Object,
        [string]$Name,
        [string]$Label
    )

    Assert-Condition ($null -ne $Object) "$Label is null"
    Assert-Condition ($Object.PSObject.Properties.Name -ccontains $Name) "$Label is missing property '$Name'"
}

function Assert-OrdinalSetEqual {
    param(
        [string[]]$Actual,
        [string[]]$Expected,
        [string]$Label
    )

    $actualSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($value in $Actual) {
        Assert-Condition ($actualSet.Add($value)) "$Label contains duplicate ordinal value '$value'"
    }

    $expectedSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($value in $Expected) {
        Assert-Condition ($expectedSet.Add($value)) "Internal validator error: duplicate expected $Label value '$value'"
    }

    $missing = @($Expected | Where-Object { -not $actualSet.Contains($_) })
    $extra = @($Actual | Where-Object { -not $expectedSet.Contains($_) })
    Assert-Condition (
        $missing.Count -eq 0 -and $extra.Count -eq 0
    ) "$Label mismatch; missing=[$($missing -join ', ')]; extra=[$($extra -join ', ')]"
}

function Invoke-GsdJson {
    param(
        [string[]]$Arguments,
        [string]$Label
    )

    $raw = & node $GsdToolsPath @Arguments
    Assert-Condition ($LASTEXITCODE -eq 0) "$Label command failed"
    try {
        return (($raw -join "`n") | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        throw "$Label returned malformed JSON: $($_.Exception.Message)"
    }
}

function Get-FrontMatter {
    param(
        [string]$Text,
        [string]$Label
    )

    $match = [regex]::Match(
        $Text,
        '\A---\r?\n(?<frontmatter>.*?)\r?\n---(?:\r?\n|\z)',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    Assert-Condition $match.Success "$Label has no exact leading frontmatter block"
    return $match.Groups['frontmatter'].Value
}

function Assert-ExactFrontMatterScalar {
    param(
        [string]$FrontMatter,
        [string]$Key,
        [string]$Value,
        [string]$Label
    )

    $keyPattern = [regex]::Escape($Key)
    $matches = [regex]::Matches(
        $FrontMatter,
        "(?m)^[ \t]*$keyPattern[ \t]*:[ \t]*(?<value>.*?)[ \t]*$"
    )
    Assert-Condition ($matches.Count -eq 1) "$Label must contain exactly one '$Key' key"
    Assert-Condition (
        $matches[0].Groups['value'].Value -ceq $Value
    ) "$Label '$Key' must be exactly '$Value', got '$($matches[0].Groups['value'].Value)'"
}

$validatorRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$builderStatusContract = [ordered]@{
    '.planning/scripts/invoke-phase0-matrix.ps1' = 'A '
    '.planning/scripts/test-phase0-matrix-runner.ps1' = 'A '
    '.planning/TEST-CONTRACT.md' = 'M '
    '.planning/scripts/validate-planning.ps1' = 'M '
    '.planning/BLOCKERS.md' = 'M '
    '.planning/EVIDENCE-REGISTER.md' = 'M '
    '.planning/STATE.md' = 'M '
    '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md' = 'M '
    '.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md' = 'M '
}

Push-Location $validatorRepoRoot
try {
    $repositoryResidue = @(
        git status --porcelain=v1 --untracked-files=all --ignored=matching
    )
    Assert-Condition ($LASTEXITCODE -eq 0) 'Ignored-aware repository status command failed'
}
finally {
    Pop-Location
}

if ($ResidueMode -ceq 'CleanCandidate') {
    Assert-Condition (
        $repositoryResidue.Count -eq 0
    ) "Clean-candidate mode requires empty ignored-aware repository status; found=[$($repositoryResidue -join '; ')]"
}
else {
    $allowedBuilderPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($builderPath in $builderStatusContract.Keys) {
        Assert-Condition (
            $allowedBuilderPaths.Add($builderPath)
        ) "Internal validator error: duplicate builder allowlist path '$builderPath'"
    }

    $seenBuilderPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    foreach ($residueLine in $repositoryResidue) {
        Assert-Condition (
            -not $residueLine.StartsWith('?? ', [System.StringComparison]::Ordinal)
        ) "Builder-staged mode forbids ordinary untracked residue: $residueLine"
        Assert-Condition (
            -not $residueLine.StartsWith('!! ', [System.StringComparison]::Ordinal)
        ) "Builder-staged mode forbids ignored residue: $residueLine"
        Assert-Condition (
            $residueLine.Length -ge 4 -and $residueLine[2] -ceq ' '
        ) "Builder-staged mode cannot parse repository residue: $residueLine"

        $statusCode = $residueLine.Substring(0, 2)
        $residuePath = $residueLine.Substring(3)
        Assert-Condition (
            $allowedBuilderPaths.Contains($residuePath)
        ) "Builder-staged mode forbids tracked path '$residuePath'"
        Assert-Condition (
            $seenBuilderPaths.Add($residuePath)
        ) "Builder-staged mode found duplicate tracked path '$residuePath'"
        $expectedStatusCode = $builderStatusContract[$residuePath]
        Assert-Condition (
            $statusCode -ceq $expectedStatusCode
        ) "Builder-staged path '$residuePath' must have status '$expectedStatusCode', got '$statusCode'"
    }

    $missingBuilderPaths = @(
        $builderStatusContract.Keys |
            Where-Object { -not $seenBuilderPaths.Contains($_) }
    )
    Assert-Condition (
        $seenBuilderPaths.Count -eq $builderStatusContract.Count -and
        $missingBuilderPaths.Count -eq 0
    ) "Builder-staged mode requires the exact nine-path correction; missing=[$($missingBuilderPaths -join ', ')]"
}

$phaseRelativePath = '.planning\phases\00-planning-truth-and-containment'
$phaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $validatorRepoRoot $phaseRelativePath))
$phaseEntry = Get-Item -LiteralPath $phaseDirectory -Force -ErrorAction Stop
Assert-Condition $phaseEntry.PSIsContainer "Phase 0 path is not a directory: $phaseDirectory"
Assert-Condition (
    -not ($phaseEntry.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
) "Phase 0 directory must not be a reparse point: $phaseDirectory"
Assert-Condition (Test-Path -LiteralPath $GsdToolsPath -PathType Leaf) "GSD tools not found: $GsdToolsPath"

$phaseFiles = @(Get-ChildItem -LiteralPath $phaseDirectory -Force -File)
$planCandidates = @(
    $phaseFiles |
        Where-Object { $_.Name -imatch '(^|-)PLAN\.md$' }
)
$summaryCandidates = @(
    $phaseFiles |
        Where-Object { $_.Name -imatch '(^|-)SUMMARY\.md$' }
)

foreach ($candidate in @($planCandidates + $summaryCandidates)) {
    Assert-Condition (
        -not ($candidate.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    ) "Plan/summary candidate must be a regular non-reparse file: $($candidate.Name)"
}

$expectedPlanNames = @(
    1..12 | ForEach-Object { '00-{0:D2}-PLAN.md' -f $_ }
)
$actualPlanNames = @($planCandidates | ForEach-Object Name)
Assert-OrdinalSetEqual $actualPlanNames $expectedPlanNames 'Phase 0 plan filenames'

$actualSummaryNames = @($summaryCandidates | ForEach-Object Name)
Assert-Condition ($actualSummaryNames.Count -le 1) "Phase 0 contains more than one summary-like file: $($actualSummaryNames -join ', ')"
if ($actualSummaryNames.Count -eq 1) {
    Assert-Condition (
        $actualSummaryNames[0] -ceq '00-04-SUMMARY.md'
    ) "Only exact ordinal filename 00-04-SUMMARY.md is permitted; found $($actualSummaryNames[0])"
}
$summaryPresent = [int]($actualSummaryNames.Count -eq 1)
$expectedArtifactStatus = if ($summaryPresent -eq 1) { 'partial' } else { 'planned' }
$expectedArtifactProgress = if ($summaryPresent -eq 1) { 8 } else { 0 }

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
$currentTruthPaths = @(
    '.planning/BLOCKERS.md',
    '.planning/EVIDENCE-REGISTER.md',
    '.planning/STATE.md',
    '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md',
    '.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md'
)
foreach ($currentTruthPath in $currentTruthPaths) {
    if (
        $currentTruthPath -ceq '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md' -and
        $summaryPresent -eq 0
    ) {
        continue
    }
    $currentTruthText = Get-Content -Raw -LiteralPath $currentTruthPath
    foreach ($currentTruthStatement in $currentTruthStatements) {
        Assert-Condition (
            $currentTruthText.Contains($currentTruthStatement)
        ) "Current-truth contract missing from '$currentTruthPath': $currentTruthStatement"
    }
}

$semanticEvidenceContracts = [ordered]@{
    '.planning/TEST-CONTRACT.md' = @(
        'Every result-bearing production label is statically mapped to one explicit',
        'Go JSON discovery rejects duplicate or case-colliding properties',
        'The exact 39',
        '1,559 explicitly synthetic tested-package events',
        'Both Vitest entries require exact 3/3 file',
        'Every captured native string is scanned for U+FFFD and U+FEFF before raw',
        'exact ordered 19-line raw npm/Next transcript'
    )
    '.planning/BLOCKERS.md' = @(
        'Exact candidate `93f5e8652354163a2f12ab6b88601e6cbaf35e0f`',
        '`96B1F854E0ABCDC49777C599F0C5BAD167359A41602745A21D735C23D4234110`',
        '`70330636AB2A07912C920723A08E81B5596F2A1F1BE456833074406D8EB76CA0`',
        '`3368C0F60999C3B3608A97BC68BEC88D24CFA96FDEBFE214991E3D46F352C643`',
        '`C08FD0D7F1B9A02296BEF242436F9716C10FC73D8427ED4B6F8251382819FEB0`',
        '`DF4E374F6B8EDEC5AC591516034D03551905A14EFA22E0749DD93C01D59D093D`',
        '`FE88A21AAE71739E977CC95D9B28C8A64A2DD56000046634E699C9F5BF6754EB`',
        '`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`',
        '`A0D9F4661F1F6329E108CD5CD7BA36235AFBE57B8747A0909CC3BE9E9BB154BA`'
    )
    '.planning/EVIDENCE-REGISTER.md' = @(
        '| EV-P0-051 |',
        '`96B1F854E0ABCDC49777C599F0C5BAD167359A41602745A21D735C23D4234110`',
        'This is parser-failure evidence only, not a matrix PASS',
        '| EV-P0-052 |',
        '| EV-P0-053 |',
        '| EV-P0-054 |',
        'This is web-path evidence only, not R5',
        '| EV-P0-055 |',
        '`FE88A21AAE71739E977CC95D9B28C8A64A2DD56000046634E699C9F5BF6754EB`',
        '| EV-P0-056 |',
        '`F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`',
        '| EV-P0-057 |',
        '`A0D9F4661F1F6329E108CD5CD7BA36235AFBE57B8747A0909CC3BE9E9BB154BA`',
        '| EV-P0-058 |',
        '`37BCCFBA90997B77577D01E2F3E35621C48E85CD1C568FC23B5982C1E6F3C13C`'
    )
    '.planning/STATE.md' = @(
        'The in-progress amended I5 parser contract removes the generic existence matcher',
        'statically maps all 49 result-bearing labels',
        'Run43 reached native-zero `web.lint` and then stopped fail closed',
        'Pre-run57 runner/test hashes `C08FD0D7F1B9A02296BEF242436F9716C10FC73D8427ED4B6F8251382819FEB0`',
        'Run57 on exact commit `457fb88e57c46d6a42add68b6fe96892e7e377b9`',
        'Run58 tested the pre-run58 runner/test hashes',
        'The repaired runner/test hashes are `F19734C253547834021544FF39F42FF4AA27BE5D57FD3D7FD547B8E9479CA421`'
    )
    '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md' = @(
        'The amended I5 contract removes the generic existence matcher',
        '49 label-to-parser removal/weakening mutations',
        'Runs51a/51b then passed exactly two authorized clean-fixture eight-command web',
        'Run57 under',
        'Run58 under `i5-go-discovery-aggregate-run58-20260724`',
        'The repaired runner/test SHA-256 values are'
    )
    '.planning/phases/00-planning-truth-and-containment/00-EVIDENCE.md' = @(
        'The amended parser library now maps all 49 result-bearing production labels',
        'discovery requires 357 unique pass identities',
        'Exactly two authorized clean-fixture web-path repetitions then passed all eight',
        'The exact 1,598 raw JSON payloads',
        'Run58 under `i5-go-discovery-aggregate-run58-20260724`',
        'The repaired runner SHA-256 is'
    )
}
foreach ($contract in $semanticEvidenceContracts.GetEnumerator()) {
    if (
        $contract.Key -ceq '.planning/phases/00-planning-truth-and-containment/00-04-SUMMARY.md' -and
        $summaryPresent -eq 0
    ) {
        continue
    }
    $contractText = Get-Content -Raw -LiteralPath $contract.Key
    foreach ($requiredText in $contract.Value) {
        Assert-Condition (
            $contractText.Contains($requiredText)
        ) "Semantic-parser evidence contract missing from '$($contract.Key)': $requiredText"
    }
}

Push-Location $validatorRepoRoot
try {
    $init = Invoke-GsdJson @('init', 'milestone-op') 'GSD milestone initialization'
    foreach ($property in @(
        'milestone_version', 'milestone_name', 'phase_count', 'completed_phases',
        'all_phases_complete', 'commit_docs'
    )) {
        Assert-HasProperty $init $property 'GSD milestone initialization'
    }
    Assert-Condition ($init.milestone_version -ceq 'v2.0') "Expected milestone v2.0, got $($init.milestone_version)"
    Assert-Condition ($init.milestone_name -ceq 'Production-Ready Rebuild') "Unexpected milestone name: $($init.milestone_name)"
    Assert-Condition ([int]$init.phase_count -eq 12) "Expected 12 phase directories, got $($init.phase_count)"
    Assert-Condition (
        [int]$init.completed_phases -eq $summaryPresent
    ) "GSD summary-bearing-phase counter must be $summaryPresent, got $($init.completed_phases)"
    Assert-Condition (-not [bool]$init.all_phases_complete) 'GSD must not report all phases complete'
    Assert-Condition ([bool]$init.commit_docs) 'Planning/evidence versioning must be enabled'

    $roadmap = Invoke-GsdJson @('roadmap', 'analyze') 'GSD roadmap analysis'
    foreach ($property in @(
        'phases', 'phase_count', 'completed_phases', 'total_plans',
        'total_summaries', 'progress_percent', 'current_phase'
    )) {
        Assert-HasProperty $roadmap $property 'GSD roadmap analysis'
    }
    Assert-Condition ([int]$roadmap.phase_count -eq 12) "Expected 12 roadmap phases, got $($roadmap.phase_count)"
    Assert-Condition ([int]$roadmap.completed_phases -eq 0) "Expected zero completed roadmap phases, got $($roadmap.completed_phases)"
    Assert-Condition ([int]$roadmap.total_plans -eq 12) "Expected 12 GSD plan artifacts, got $($roadmap.total_plans)"
    Assert-Condition (
        [int]$roadmap.total_summaries -eq $summaryPresent
    ) "Expected $summaryPresent GSD summary artifacts, got $($roadmap.total_summaries)"
    Assert-Condition (
        [int]$roadmap.progress_percent -eq $expectedArtifactProgress
    ) "Expected GSD artifact progress $expectedArtifactProgress%, got $($roadmap.progress_percent)%"
    Assert-Condition ([string]$roadmap.current_phase -ceq '0') "Expected current phase 0, got $($roadmap.current_phase)"
    Assert-Condition (@($roadmap.phases).Count -eq 12) "Expected 12 roadmap phase objects, got $(@($roadmap.phases).Count)"

    $actualPhaseNumbers = @($roadmap.phases | ForEach-Object { [string]$_.number })
    $expectedPhaseNumbers = @(0..11 | ForEach-Object { [string]$_ })
    Assert-OrdinalSetEqual $actualPhaseNumbers $expectedPhaseNumbers 'GSD roadmap phase numbers'

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
        foreach ($property in @('number', 'depends_on')) {
            Assert-HasProperty $phase $property "GSD roadmap phase object"
        }
        $phaseNumber = [string]$phase.number
        Assert-Condition $expectedDependencies.ContainsKey($phaseNumber) "Unexpected phase number: $phaseNumber"
        Assert-Condition (
            [string]$phase.depends_on -ceq $expectedDependencies[$phaseNumber]
        ) "Phase $phaseNumber dependency mismatch: $($phase.depends_on)"
    }

    $phaseZeroMatches = @($roadmap.phases | Where-Object { [string]$_.number -ceq '0' })
    Assert-Condition ($phaseZeroMatches.Count -eq 1) "Expected exactly one GSD Phase 0 object, got $($phaseZeroMatches.Count)"
    $phaseZero = $phaseZeroMatches[0]
    foreach ($property in @('plan_count', 'summary_count', 'disk_status', 'roadmap_complete')) {
        Assert-HasProperty $phaseZero $property 'GSD Phase 0'
    }
    Assert-Condition ([int]$phaseZero.plan_count -eq 12) "Expected Phase 0 plan_count=12, got $($phaseZero.plan_count)"
    Assert-Condition (
        [int]$phaseZero.summary_count -eq $summaryPresent
    ) "Expected Phase 0 summary_count=$summaryPresent, got $($phaseZero.summary_count)"
    Assert-Condition (
        [string]$phaseZero.disk_status -ceq $expectedArtifactStatus
    ) "Expected Phase 0 artifact state '$expectedArtifactStatus', got '$($phaseZero.disk_status)'"
    Assert-Condition (-not [bool]$phaseZero.roadmap_complete) 'GSD must not report Phase 0 roadmap completion'

    $stateText = Get-Content -Raw -LiteralPath '.planning\STATE.md'
    $stateFrontMatter = Get-FrontMatter $stateText 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'current_phase' '0 of 12 (planning truth and containment)' 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'status' 'in_progress' 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'total_phases' '12' 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'completed_phases' '0' 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'total_plans' '12' 'STATE'
    Assert-ExactFrontMatterScalar $stateFrontMatter 'completed_plans' '0' 'STATE'

    $roadmapText = Get-Content -Raw -LiteralPath '.planning\ROADMAP.md'
    $phaseZeroChecklistMatches = [regex]::Matches(
        $roadmapText,
        '(?m)^- \[(?<mark>[ xX])\] \*\*Phase 0: Planning Truth and Containment\*\*\s*$'
    )
    Assert-Condition (
        $phaseZeroChecklistMatches.Count -eq 1
    ) "ROADMAP must contain exactly one Phase 0 checklist entry, got $($phaseZeroChecklistMatches.Count)"
    Assert-Condition (
        $phaseZeroChecklistMatches[0].Groups['mark'].Value -ceq ' '
    ) 'ROADMAP Phase 0 checklist must remain unchecked'
    $phaseZeroSectionMatches = [regex]::Matches(
        $roadmapText,
        '(?ms)^### Phase 0: Planning Truth and Containment\s*(?<body>.*?)(?=^### Phase 1:|\z)'
    )
    Assert-Condition (
        $phaseZeroSectionMatches.Count -eq 1
    ) "ROADMAP must contain exactly one Phase 0 details section, got $($phaseZeroSectionMatches.Count)"
    $phaseZeroStatusMatches = [regex]::Matches(
        $phaseZeroSectionMatches[0].Groups['body'].Value,
        '(?m)^\*\*Status:\*\*\s*(?<status>.*?)\s*$'
    )
    Assert-Condition (
        $phaseZeroStatusMatches.Count -eq 1
    ) "ROADMAP Phase 0 must contain exactly one status, got $($phaseZeroStatusMatches.Count)"
    Assert-Condition (
        $phaseZeroStatusMatches[0].Groups['status'].Value -ceq 'In progress'
    ) "ROADMAP Phase 0 status must be exactly 'In progress'"

    $requirementsText = Get-Content -Raw -LiteralPath '.planning\REQUIREMENTS.md'
    $declaredRequirementMatches = [regex]::Matches(
        $requirementsText,
        '(?m)^\*\*Active requirements:\*\*\s*(?<count>[0-9]+)\s*$'
    )
    Assert-Condition (
        $declaredRequirementMatches.Count -eq 1 -and
        [int]$declaredRequirementMatches[0].Groups['count'].Value -eq 89
    ) 'REQUIREMENTS must declare exactly 89 active requirements'
    $requirementMatches = [regex]::Matches(
        $requirementsText,
        '(?m)^- \[(?<mark>[ xX])\] \*\*(?<id>[A-Z]+-[0-9]{2}):\*\*'
    )
    $requirementIds = @($requirementMatches | ForEach-Object { $_.Groups['id'].Value })
    $uncheckedRequirementIds = @(
        $requirementMatches |
            Where-Object { $_.Groups['mark'].Value -ceq ' ' } |
            ForEach-Object { $_.Groups['id'].Value }
    )
    $checkedRequirementIds = @(
        $requirementMatches |
            Where-Object { $_.Groups['mark'].Value -cne ' ' } |
            ForEach-Object { $_.Groups['id'].Value }
    )
    $expectedRequirementGroups = [ordered]@{
        'ARCH' = 1; 'ASSURE' = 8; 'AUD' = 1; 'BASE' = 7; 'CHAIN' = 7
        'COMM' = 2; 'COMP' = 3; 'DOC' = 1; 'DOMAIN' = 1; 'FIN' = 5
        'IAM' = 5; 'LAUNCH' = 6; 'LEGAL' = 5; 'LIFE' = 8; 'OPS' = 3
        'PILOT' = 8; 'PROD' = 2; 'PROV' = 3; 'REL' = 5; 'REP' = 1
        'UX' = 7
    }
    $expectedRequirementIds = @(
        foreach ($group in $expectedRequirementGroups.GetEnumerator()) {
            1..$group.Value | ForEach-Object { '{0}-{1:D2}' -f $group.Key, $_ }
        }
    )
    Assert-Condition ($requirementIds.Count -eq 89) "Expected 89 active requirement occurrences, got $($requirementIds.Count)"
    Assert-Condition ($uncheckedRequirementIds.Count -eq 89) "Expected 89 unchecked requirements, got $($uncheckedRequirementIds.Count)"
    Assert-Condition ($checkedRequirementIds.Count -eq 0) "Checked requirements are forbidden: $($checkedRequirementIds -join ', ')"
    Assert-OrdinalSetEqual $requirementIds $expectedRequirementIds 'Active requirement IDs'

    if ($summaryPresent -eq 1) {
        $summaryPath = Join-Path $phaseDirectory '00-04-SUMMARY.md'
        $summaryText = Get-Content -Raw -LiteralPath $summaryPath
        $summaryFrontMatter = Get-FrontMatter $summaryText '00-04-SUMMARY.md'
        Assert-ExactFrontMatterScalar $summaryFrontMatter 'phase' '00-planning-truth-and-containment' '00-04-SUMMARY.md'
        Assert-ExactFrontMatterScalar $summaryFrontMatter 'plan' '04' '00-04-SUMMARY.md'
        Assert-ExactFrontMatterScalar $summaryFrontMatter 'status' 'implementation_frozen_for_independent_review' '00-04-SUMMARY.md'
        Assert-ExactFrontMatterScalar $summaryFrontMatter 'release_status' 'NO-GO' '00-04-SUMMARY.md'
        Assert-ExactFrontMatterScalar $summaryFrontMatter 'requirements-completed' '[]' '00-04-SUMMARY.md'
        Assert-Condition (
            $summaryText.Contains('Phase 0 remains `in_progress`.')
        ) 'Summary must state exactly that Phase 0 remains in_progress'
        Assert-Condition (
            $summaryText.Contains('This is builder evidence only.')
        ) 'Summary must state exactly that this is builder evidence only'
        Assert-Condition (
            $summaryText.Contains('Tasks 3-5 remain mandatory.')
        ) 'Summary must state exactly that Tasks 3-5 remain mandatory'
        Assert-Condition (
            $summaryText.Contains(
                'This is not independent review, verification, Phase completion, requirement completion, local candidate admission, or production approval.'
            )
        ) 'Summary must retain the exact independent-review/completion/production non-claim'
        Assert-Condition (
            $summaryText.Contains('V3 is preserved but was not admitted as C3.')
        ) 'Summary must state exactly that V3 was preserved but not admitted'
        Assert-Condition (
            $summaryText.Contains('The stale broad generated-cleanliness conclusions are superseded.')
        ) 'Summary must state exactly that stale broad generated-cleanliness conclusions are superseded'
    }

    $health = Invoke-GsdJson @('validate', 'health') 'GSD planning health'
    foreach ($property in @('status', 'errors', 'warnings')) {
        Assert-HasProperty $health $property 'GSD planning health'
    }
    Assert-Condition ([string]$health.status -ceq 'healthy') "Expected healthy planning state, got $($health.status)"
    Assert-Condition (@($health.errors).Count -eq 0) "Planning health errors: $($health.errors.message -join '; ')"
    Assert-Condition (@($health.warnings).Count -eq 0) "Planning health warnings: $($health.warnings.message -join '; ')"

    Write-Output 'PLANNING_VALIDATION=PASS'
    Write-Output 'MILESTONE=v2.0 Production-Ready Rebuild'
    Write-Output 'PHASES=12'
    Write-Output 'PLANS=12'
    Write-Output "GSD_ARTIFACT_STATE=$expectedArtifactStatus"
    Write-Output "GSD_ARTIFACT_PROGRESS=$expectedArtifactProgress%"
    Write-Output "REPOSITORY_RESIDUE_MODE=$ResidueMode"
    Write-Output 'AUTHORITATIVE_PRODUCTION_PROGRESS=0%'
    Write-Output 'ACTIVE_REQUIREMENTS=89'
    Write-Output 'CHECKED_REQUIREMENTS=0'
}
finally {
    Pop-Location
}
