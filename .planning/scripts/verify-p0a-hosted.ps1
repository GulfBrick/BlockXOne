[CmdletBinding()]
param(
    [Parameter()]
    [AllowNull()]
    [AllowEmptyString()]
    [string]$CandidateSha,

    [Parameter()]
    [AllowNull()]
    [AllowEmptyString()]
    [string]$ExpectedMainSha,

    [Parameter()]
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepositoryName = 'GulfBrick/BlockXOne'
$script:ExpectedBranch = 'codex/functional-platform'
$script:ExpectedUpstream = 'origin/codex/functional-platform'
$script:ExpectedWorkflowName = 'CI'
$script:ExpectedWorkflowPath = '.github/workflows/ci.yml'
$script:ExpectedOriginUrl = 'https://github.com/GulfBrick/BlockXOne.git'
$script:ExpectedLegacyFetchUrl = 'C:\Users\danie\Documents\BlockXOne Production Gen3'
$script:ExpectedLegacyPushUrl = 'disabled://blockxone/legacy-gen3-read-only'
$script:RequiredJobNames = @(
    'Planning and production policy'
    'Go build, test, vet and lint'
    'Clean and current-schema migration smoke tests'
    'Web install, test, lint and build'
    'Contract compile and test'
    'Mandatory source and dependency security gates'
    'Build container candidates without publishing'
)

function Throw-VerificationFailure {
    param(
        [Parameter(Mandatory)]
        [string]$Message
    )

    throw [System.InvalidOperationException]::new($Message)
}

function Assert-LowercaseFullSha {
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Value,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if ([string]::IsNullOrEmpty($Value) -or
        -not [regex]::IsMatch(
            $Value,
            '\A[0-9a-f]{40}\z',
            [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
        )) {
        Throw-VerificationFailure "$Label must be exactly 40 lowercase hexadecimal characters."
    }
}

function Assert-ExactString {
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Actual,

        [Parameter(Mandatory)]
        [string]$Expected,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if ($Actual -cne $Expected) {
        Throw-VerificationFailure "$Label does not match the required value."
    }
}

function Assert-ExactStringSet {
    param(
        [Parameter()]
        [AllowNull()]
        [object[]]$Actual,

        [Parameter(Mandatory)]
        [string[]]$Expected,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $actualItems = @($Actual)
    if ($actualItems.Count -ne $Expected.Count) {
        Throw-VerificationFailure "$Label does not contain the required exact set."
    }

    foreach ($expectedItem in $Expected) {
        $matches = @(
            $actualItems |
                Where-Object { ([string]$_) -ceq $expectedItem }
        )
        if ($matches.Count -ne 1) {
            Throw-VerificationFailure "$Label does not contain the required exact set."
        }
    }
}

function Assert-ExactlyOneString {
    param(
        [Parameter()]
        [AllowNull()]
        [object[]]$Actual,

        [Parameter(Mandatory)]
        [string]$Expected,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $actualItems = @($Actual)
    if ($actualItems.Count -ne 1 -or ([string]$actualItems[0]) -cne $Expected) {
        Throw-VerificationFailure "$Label must contain exactly one required value."
    }
}

function Assert-OriginUrlsHaveNoCredentials {
    param(
        [Parameter()]
        [AllowNull()]
        [object[]]$Urls
    )

    foreach ($urlValue in @($Urls)) {
        $parsed = $null
        $isAbsolute = [uri]::TryCreate(
            [string]$urlValue,
            [System.UriKind]::Absolute,
            [ref]$parsed
        )
        if (-not $isAbsolute -or $null -eq $parsed) {
            Throw-VerificationFailure 'The origin remote URL is not an allowed absolute URL.'
        }
        if (-not [string]::IsNullOrEmpty($parsed.UserInfo)) {
            Throw-VerificationFailure 'The origin remote URL must not contain credentials.'
        }
    }
}

function ConvertTo-NonNegativeInt64 {
    param(
        [Parameter()]
        [AllowNull()]
        [object]$Value,

        [Parameter(Mandatory)]
        [string]$Label
    )

    [long]$parsed = 0
    $valid = [long]::TryParse(
        [string]$Value,
        [System.Globalization.NumberStyles]::None,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )
    if (-not $valid -or $parsed -lt 0) {
        Throw-VerificationFailure "$Label must be a non-negative integer."
    }

    return $parsed
}

function Assert-ValidRunUrl {
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Value,

        [Parameter(Mandatory)]
        [long]$RunId
    )

    $parsed = $null
    $isAbsolute = [uri]::TryCreate(
        $Value,
        [System.UriKind]::Absolute,
        [ref]$parsed
    )
    if (-not $isAbsolute -or $null -eq $parsed) {
        Throw-VerificationFailure 'The workflow run URL must be a non-empty absolute URL.'
    }

    $expectedPath = "/GulfBrick/BlockXOne/actions/runs/$RunId"
    if ($parsed.Scheme -cne 'https' -or
        $parsed.Host -cne 'github.com' -or
        $parsed.AbsolutePath -cne $expectedPath -or
        -not [string]::IsNullOrEmpty($parsed.Query) -or
        -not [string]::IsNullOrEmpty($parsed.Fragment) -or
        -not [string]::IsNullOrEmpty($parsed.UserInfo)) {
        Throw-VerificationFailure 'The workflow run URL is not the expected safe GitHub run URL.'
    }
}

function Test-P0aEvidence {
    param(
        [Parameter(Mandatory)]
        [psobject]$Evidence
    )

    Assert-LowercaseFullSha -Value ([string]$Evidence.CandidateSha) -Label 'CandidateSha'
    Assert-LowercaseFullSha -Value ([string]$Evidence.ExpectedMainSha) -Label 'ExpectedMainSha'
    Assert-LowercaseFullSha -Value ([string]$Evidence.LocalHeadSha) -Label 'Local HEAD SHA'
    Assert-LowercaseFullSha -Value ([string]$Evidence.RemoteHeadSha) -Label 'Hosted branch SHA'
    Assert-LowercaseFullSha -Value ([string]$Evidence.MainSha) -Label 'Hosted main SHA'
    Assert-LowercaseFullSha -Value ([string]$Evidence.WorkflowHeadSha) -Label 'Workflow head SHA'

    if ($Evidence.HeadDetached -ne $false) {
        Throw-VerificationFailure 'Local HEAD must not be detached.'
    }
    Assert-ExactString `
        -Actual ([string]$Evidence.LocalBranch) `
        -Expected $script:ExpectedBranch `
        -Label 'Local branch'
    Assert-ExactString `
        -Actual ([string]$Evidence.LocalHeadSha) `
        -Expected ([string]$Evidence.CandidateSha) `
        -Label 'Local HEAD SHA'
    if (-not [string]::IsNullOrEmpty([string]$Evidence.GitStatus)) {
        Throw-VerificationFailure 'The ignored-aware Git status must be empty.'
    }

    Assert-ExactStringSet `
        -Actual @($Evidence.RemoteNames) `
        -Expected @('origin', 'legacy-gen3') `
        -Label 'Git remotes'
    Assert-OriginUrlsHaveNoCredentials -Urls @($Evidence.OriginFetchUrls)
    Assert-OriginUrlsHaveNoCredentials -Urls @($Evidence.OriginPushUrls)
    Assert-ExactlyOneString `
        -Actual @($Evidence.OriginFetchUrls) `
        -Expected $script:ExpectedOriginUrl `
        -Label 'Origin fetch URLs'
    Assert-ExactlyOneString `
        -Actual @($Evidence.OriginPushUrls) `
        -Expected $script:ExpectedOriginUrl `
        -Label 'Origin push URLs'
    Assert-ExactlyOneString `
        -Actual @($Evidence.LegacyFetchUrls) `
        -Expected $script:ExpectedLegacyFetchUrl `
        -Label 'Legacy fetch URLs'
    Assert-ExactlyOneString `
        -Actual @($Evidence.LegacyPushUrls) `
        -Expected $script:ExpectedLegacyPushUrl `
        -Label 'Legacy push URLs'
    Assert-ExactString `
        -Actual ([string]$Evidence.Upstream) `
        -Expected $script:ExpectedUpstream `
        -Label 'Active branch upstream'

    Assert-ExactString `
        -Actual ([string]$Evidence.RemoteHeadSha) `
        -Expected ([string]$Evidence.CandidateSha) `
        -Label 'Hosted branch SHA'

    Assert-ExactString `
        -Actual ([string]$Evidence.RepositoryFullName) `
        -Expected $script:RepositoryName `
        -Label 'GitHub repository'
    if ($Evidence.RepositoryPrivate -ne $true) {
        Throw-VerificationFailure 'The GitHub repository must remain private.'
    }
    Assert-ExactString `
        -Actual ([string]$Evidence.DefaultBranch) `
        -Expected 'main' `
        -Label 'GitHub default branch'
    Assert-ExactString `
        -Actual ([string]$Evidence.MainSha) `
        -Expected ([string]$Evidence.ExpectedMainSha) `
        -Label 'GitHub main SHA'

    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowName) `
        -Expected $script:ExpectedWorkflowName `
        -Label 'Workflow name'
    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowPath) `
        -Expected $script:ExpectedWorkflowPath `
        -Label 'Workflow path'
    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowBranch) `
        -Expected $script:ExpectedBranch `
        -Label 'Workflow branch'
    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowHeadSha) `
        -Expected ([string]$Evidence.CandidateSha) `
        -Label 'Workflow head SHA'
    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowStatus) `
        -Expected 'completed' `
        -Label 'Workflow status'
    Assert-ExactString `
        -Actual ([string]$Evidence.WorkflowConclusion) `
        -Expected 'success' `
        -Label 'Workflow conclusion'

    $runId = ConvertTo-NonNegativeInt64 -Value $Evidence.RunId -Label 'Workflow run ID'
    if ($runId -eq 0) {
        Throw-VerificationFailure 'The workflow run ID must be nonzero.'
    }
    Assert-ValidRunUrl -Value ([string]$Evidence.RunUrl) -RunId $runId

    $jobs = @($Evidence.Jobs)
    $reportedJobCount = ConvertTo-NonNegativeInt64 `
        -Value $Evidence.ReportedJobCount `
        -Label 'Reported job count'
    if ($reportedJobCount -ne $jobs.Count) {
        Throw-VerificationFailure 'The reported job count does not match the fetched jobs.'
    }
    if ($jobs.Count -ne $script:RequiredJobNames.Count) {
        Throw-VerificationFailure 'The workflow does not contain the exact mandatory job count.'
    }

    $jobNames = @($jobs | ForEach-Object { [string]$_.Name })
    Assert-ExactStringSet `
        -Actual $jobNames `
        -Expected $script:RequiredJobNames `
        -Label 'Workflow jobs'

    $receiptJobs = [System.Collections.Generic.List[object]]::new()
    foreach ($requiredJobName in $script:RequiredJobNames) {
        $matchingJobs = @(
            $jobs |
                Where-Object { ([string]$_.Name) -ceq $requiredJobName }
        )
        if ($matchingJobs.Count -ne 1) {
            Throw-VerificationFailure 'Every mandatory workflow job must appear exactly once.'
        }

        $job = $matchingJobs[0]
        Assert-ExactString `
            -Actual ([string]$job.Status) `
            -Expected 'completed' `
            -Label 'Mandatory job status'
        Assert-ExactString `
            -Actual ([string]$job.Conclusion) `
            -Expected 'success' `
            -Label 'Mandatory job conclusion'

        [void]$receiptJobs.Add(
            [ordered]@{
                name = $requiredJobName
                status = 'completed'
                conclusion = 'success'
            }
        )
    }

    return [ordered]@{
        candidateSha = [string]$Evidence.CandidateSha
        local = [ordered]@{
            branch = [string]$Evidence.LocalBranch
            headSha = [string]$Evidence.LocalHeadSha
            upstream = [string]$Evidence.Upstream
            ignoredAwareTreeClean = $true
        }
        hostedBranch = [ordered]@{
            branch = $script:ExpectedBranch
            headSha = [string]$Evidence.RemoteHeadSha
        }
        repository = [ordered]@{
            fullName = [string]$Evidence.RepositoryFullName
            private = $true
            defaultBranch = [string]$Evidence.DefaultBranch
            mainSha = [string]$Evidence.MainSha
        }
        workflow = [ordered]@{
            id = $runId
            url = [string]$Evidence.RunUrl
            name = [string]$Evidence.WorkflowName
            path = [string]$Evidence.WorkflowPath
            branch = [string]$Evidence.WorkflowBranch
            headSha = [string]$Evidence.WorkflowHeadSha
            status = [string]$Evidence.WorkflowStatus
            conclusion = [string]$Evidence.WorkflowConclusion
        }
        jobs = @($receiptJobs)
    }
}

function Copy-SelfTestFixture {
    param(
        [Parameter(Mandatory)]
        [psobject]$Fixture
    )

    $json = $Fixture | ConvertTo-Json -Depth 12 -Compress
    return $json | ConvertFrom-Json -Depth 12
}

function Assert-SelfTestRejects {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [psobject]$ValidFixture,

        [Parameter(Mandatory)]
        [scriptblock]$Mutate
    )

    $copy = Copy-SelfTestFixture -Fixture $ValidFixture
    $mutated = & $Mutate $copy
    if ($null -eq $mutated) {
        $mutated = $copy
    }

    try {
        $null = Test-P0aEvidence -Evidence $mutated
    }
    catch {
        return $Name
    }

    Throw-VerificationFailure "Self-test case '$Name' did not fail closed."
}

function Invoke-SelfTest {
    $candidate = '1111111111111111111111111111111111111111'
    $main = '2222222222222222222222222222222222222222'
    $other = '3333333333333333333333333333333333333333'
    $runId = 424242

    $jobs = @(
        foreach ($jobName in $script:RequiredJobNames) {
            [pscustomobject]@{
                Name = $jobName
                Status = 'completed'
                Conclusion = 'success'
            }
        }
    )

    $validFixture = [pscustomobject]@{
        CandidateSha = $candidate
        ExpectedMainSha = $main
        HeadDetached = $false
        LocalBranch = $script:ExpectedBranch
        LocalHeadSha = $candidate
        GitStatus = ''
        RemoteNames = @('origin', 'legacy-gen3')
        OriginFetchUrls = @($script:ExpectedOriginUrl)
        OriginPushUrls = @($script:ExpectedOriginUrl)
        LegacyFetchUrls = @($script:ExpectedLegacyFetchUrl)
        LegacyPushUrls = @($script:ExpectedLegacyPushUrl)
        Upstream = $script:ExpectedUpstream
        RemoteHeadSha = $candidate
        RepositoryFullName = $script:RepositoryName
        RepositoryPrivate = $true
        DefaultBranch = 'main'
        MainSha = $main
        WorkflowName = $script:ExpectedWorkflowName
        WorkflowPath = $script:ExpectedWorkflowPath
        WorkflowBranch = $script:ExpectedBranch
        WorkflowHeadSha = $candidate
        WorkflowStatus = 'completed'
        WorkflowConclusion = 'success'
        RunId = $runId
        RunUrl = "https://github.com/GulfBrick/BlockXOne/actions/runs/$runId"
        ReportedJobCount = $jobs.Count
        Jobs = $jobs
    }

    $null = Test-P0aEvidence -Evidence $validFixture

    $passedCases = [System.Collections.Generic.List[string]]::new()

    [void]$passedCases.Add((Assert-SelfTestRejects 'empty-workflow-name' $validFixture {
        param($fixture)
        $fixture.WorkflowName = ''
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'zero-jobs' $validFixture {
        param($fixture)
        $fixture.Jobs = @()
        $fixture.ReportedJobCount = 0
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'abbreviated-candidate-sha' $validFixture {
        param($fixture)
        $fixture.CandidateSha = '1111111'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'invalid-candidate-sha' $validFixture {
        param($fixture)
        $fixture.CandidateSha = 'not-a-sha'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'uppercase-candidate-sha' $validFixture {
        param($fixture)
        $fixture.CandidateSha = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-candidate-sha' $validFixture {
        param($fixture)
        $fixture.CandidateSha = $other
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'invalid-expected-main-sha' $validFixture {
        param($fixture)
        $fixture.ExpectedMainSha = '2222222'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'detached-local-head' $validFixture {
        param($fixture)
        $fixture.HeadDetached = $true
        $fixture.LocalBranch = ''
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-local-branch' $validFixture {
        param($fixture)
        $fixture.LocalBranch = 'main'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-local-head-sha' $validFixture {
        param($fixture)
        $fixture.LocalHeadSha = $other
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'dirty-ignored-aware-status' $validFixture {
        param($fixture)
        $fixture.GitStatus = '!! .npm-cache/'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-hosted-branch-sha' $validFixture {
        param($fixture)
        $fixture.RemoteHeadSha = $other
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'failed-workflow-run' $validFixture {
        param($fixture)
        $fixture.WorkflowConclusion = 'failure'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'incomplete-workflow-run' $validFixture {
        param($fixture)
        $fixture.WorkflowStatus = 'in_progress'
        $fixture.WorkflowConclusion = ''
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-workflow-path' $validFixture {
        param($fixture)
        $fixture.WorkflowPath = '.github/workflows/other.yml'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-workflow-branch' $validFixture {
        param($fixture)
        $fixture.WorkflowBranch = 'main'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-workflow-head-sha' $validFixture {
        param($fixture)
        $fixture.WorkflowHeadSha = $other
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'zero-run-id' $validFixture {
        param($fixture)
        $fixture.RunId = 0
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'empty-run-url' $validFixture {
        param($fixture)
        $fixture.RunUrl = ''
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'skipped-mandatory-job' $validFixture {
        param($fixture)
        $fixture.Jobs[0].Conclusion = 'skipped'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'failed-mandatory-job' $validFixture {
        param($fixture)
        $fixture.Jobs[1].Conclusion = 'failure'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'incomplete-mandatory-job' $validFixture {
        param($fixture)
        $fixture.Jobs[2].Status = 'in_progress'
        $fixture.Jobs[2].Conclusion = ''
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'missing-mandatory-job' $validFixture {
        param($fixture)
        $fixture.Jobs = @($fixture.Jobs | Select-Object -Skip 1)
        $fixture.ReportedJobCount = $fixture.Jobs.Count
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'duplicate-mandatory-job' $validFixture {
        param($fixture)
        $fixture.Jobs = @($fixture.Jobs) + @($fixture.Jobs[0])
        $fixture.ReportedJobCount = $fixture.Jobs.Count
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'extra-workflow-job' $validFixture {
        param($fixture)
        $fixture.Jobs = @($fixture.Jobs) + @(
            [pscustomobject]@{
                Name = 'Unexpected extra job'
                Status = 'completed'
                Conclusion = 'success'
            }
        )
        $fixture.ReportedJobCount = $fixture.Jobs.Count
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'reported-job-count-mismatch' $validFixture {
        param($fixture)
        $fixture.ReportedJobCount = 0
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'missing-remote' $validFixture {
        param($fixture)
        $fixture.RemoteNames = @('origin')
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'extra-remote' $validFixture {
        param($fixture)
        $fixture.RemoteNames = @('origin', 'legacy-gen3', 'unexpected')
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'swapped-remote-routing' $validFixture {
        param($fixture)
        $fixture.OriginFetchUrls = @($script:ExpectedLegacyFetchUrl)
        $fixture.OriginPushUrls = @($script:ExpectedLegacyPushUrl)
        $fixture.LegacyFetchUrls = @($script:ExpectedOriginUrl)
        $fixture.LegacyPushUrls = @($script:ExpectedOriginUrl)
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'credential-bearing-origin' $validFixture {
        param($fixture)
        $fixture.OriginFetchUrls = @('https://fixture-user:fixture-placeholder@github.com/GulfBrick/BlockXOne.git')
        $fixture.OriginPushUrls = @('https://fixture-user:fixture-placeholder@github.com/GulfBrick/BlockXOne.git')
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'extra-origin-fetch-url' $validFixture {
        param($fixture)
        $fixture.OriginFetchUrls = @(
            $script:ExpectedOriginUrl,
            'https://github.com/GulfBrick/BlockXOne-mirror.git'
        )
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-legacy-fetch' $validFixture {
        param($fixture)
        $fixture.LegacyFetchUrls = @('C:\wrong\legacy')
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-legacy-push-sentinel' $validFixture {
        param($fixture)
        $fixture.LegacyPushUrls = @('disabled://blockxone/wrong')
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-upstream' $validFixture {
        param($fixture)
        $fixture.Upstream = 'origin/main'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-repository-name' $validFixture {
        param($fixture)
        $fixture.RepositoryFullName = 'GulfBrick/Other'
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'public-repository' $validFixture {
        param($fixture)
        $fixture.RepositoryPrivate = $false
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-default-branch' $validFixture {
        param($fixture)
        $fixture.DefaultBranch = $script:ExpectedBranch
        return $fixture
    }))
    [void]$passedCases.Add((Assert-SelfTestRejects 'wrong-main-sha' $validFixture {
        param($fixture)
        $fixture.MainSha = $other
        return $fixture
    }))

    return [ordered]@{
        schema = 'blockxone.p0a.hosted.self-test.v1'
        result = 'passed'
        caseCount = $passedCases.Count
        cases = @($passedCases)
    }
}

function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $command = Get-Command -Name $FilePath -CommandType Application -ErrorAction Stop
    $nativeOutput = @(& $command.Source @ArgumentList 2>&1)
    $exitCode = [int]$LASTEXITCODE
    $textOutput = (
        $nativeOutput |
            ForEach-Object { [string]$_ }
    ) -join "`n"

    return [pscustomobject]@{
        ExitCode = $exitCode
        Text = $textOutput.TrimEnd("`r", "`n")
        Label = $Label
    }
}

function Invoke-NativeText {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $result = Invoke-NativeCapture `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -Label $Label
    if ($result.ExitCode -ne 0) {
        Throw-VerificationFailure "$Label failed."
    }

    return [string]$result.Text
}

function Convert-TextToLines {
    param(
        [Parameter()]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Text
    )

    if ([string]::IsNullOrEmpty($Text)) {
        return @()
    }

    return @(
        $Text -split '\r?\n' |
            Where-Object { -not [string]::IsNullOrEmpty($_) }
    )
}

function Invoke-GitCapture {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$Label
    )

    return Invoke-NativeCapture `
        -FilePath 'git' `
        -ArgumentList (@('-C', $RepositoryRoot) + $ArgumentList) `
        -Label $Label
}

function Invoke-GitText {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot,

        [Parameter(Mandatory)]
        [string[]]$ArgumentList,

        [Parameter(Mandatory)]
        [string]$Label
    )

    return Invoke-NativeText `
        -FilePath 'git' `
        -ArgumentList (@('-C', $RepositoryRoot) + $ArgumentList) `
        -Label $Label
}

function Invoke-GhApiJson {
    param(
        [Parameter(Mandatory)]
        [string]$Endpoint,

        [Parameter(Mandatory)]
        [string]$Label
    )

    $json = Invoke-NativeText `
        -FilePath 'gh' `
        -ArgumentList @(
            'api',
            '--method',
            'GET',
            '-H',
            'Accept: application/vnd.github+json',
            '-H',
            'X-GitHub-Api-Version: 2022-11-28',
            $Endpoint
        ) `
        -Label $Label
    try {
        return $json | ConvertFrom-Json -Depth 20
    }
    catch {
        Throw-VerificationFailure "$Label returned invalid JSON."
    }
}

function Get-LiveEvidence {
    param(
        [Parameter(Mandatory)]
        [string]$LiveCandidateSha,

        [Parameter(Mandatory)]
        [string]$LiveExpectedMainSha
    )

    Assert-LowercaseFullSha -Value $LiveCandidateSha -Label 'CandidateSha'
    Assert-LowercaseFullSha -Value $LiveExpectedMainSha -Label 'ExpectedMainSha'

    $repositoryRoot = (
        Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')
    ).Path

    $branchResult = Invoke-GitCapture `
        -RepositoryRoot $repositoryRoot `
        -ArgumentList @('symbolic-ref', '--quiet', '--short', 'HEAD') `
        -Label 'Local branch inspection'
    $headDetached = $branchResult.ExitCode -ne 0
    $localBranch = if ($headDetached) { '' } else { $branchResult.Text }

    $localHead = Invoke-GitText `
        -RepositoryRoot $repositoryRoot `
        -ArgumentList @('rev-parse', '--verify', 'HEAD') `
        -Label 'Local HEAD inspection'
    $gitStatus = Invoke-GitText `
        -RepositoryRoot $repositoryRoot `
        -ArgumentList @(
            'status',
            '--porcelain=v1',
            '--untracked-files=all',
            '--ignored=matching'
        ) `
        -Label 'Ignored-aware Git status inspection'
    $upstream = Invoke-GitText `
        -RepositoryRoot $repositoryRoot `
        -ArgumentList @(
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            '@{upstream}'
        ) `
        -Label 'Active upstream inspection'

    $remoteNames = Convert-TextToLines -Text (
        Invoke-GitText `
            -RepositoryRoot $repositoryRoot `
            -ArgumentList @('remote') `
            -Label 'Git remote inventory'
    )
    $originFetchUrls = Convert-TextToLines -Text (
        Invoke-GitText `
            -RepositoryRoot $repositoryRoot `
            -ArgumentList @('remote', 'get-url', '--all', 'origin') `
            -Label 'Origin fetch routing inspection'
    )
    $originPushUrls = Convert-TextToLines -Text (
        Invoke-GitText `
            -RepositoryRoot $repositoryRoot `
            -ArgumentList @('remote', 'get-url', '--push', '--all', 'origin') `
            -Label 'Origin push routing inspection'
    )
    $legacyFetchUrls = Convert-TextToLines -Text (
        Invoke-GitText `
            -RepositoryRoot $repositoryRoot `
            -ArgumentList @('remote', 'get-url', '--all', 'legacy-gen3') `
            -Label 'Legacy fetch routing inspection'
    )
    $legacyPushUrls = Convert-TextToLines -Text (
        Invoke-GitText `
            -RepositoryRoot $repositoryRoot `
            -ArgumentList @('remote', 'get-url', '--push', '--all', 'legacy-gen3') `
            -Label 'Legacy push routing inspection'
    )

    # Validate every local and routing invariant before contacting origin.
    Assert-LowercaseFullSha -Value $localHead -Label 'Local HEAD SHA'
    if ($headDetached) {
        Throw-VerificationFailure 'Local HEAD must not be detached.'
    }
    Assert-ExactString -Actual $localBranch -Expected $script:ExpectedBranch -Label 'Local branch'
    Assert-ExactString -Actual $localHead -Expected $LiveCandidateSha -Label 'Local HEAD SHA'
    if (-not [string]::IsNullOrEmpty($gitStatus)) {
        Throw-VerificationFailure 'The ignored-aware Git status must be empty.'
    }
    Assert-ExactStringSet `
        -Actual $remoteNames `
        -Expected @('origin', 'legacy-gen3') `
        -Label 'Git remotes'
    Assert-OriginUrlsHaveNoCredentials -Urls $originFetchUrls
    Assert-OriginUrlsHaveNoCredentials -Urls $originPushUrls
    Assert-ExactlyOneString `
        -Actual $originFetchUrls `
        -Expected $script:ExpectedOriginUrl `
        -Label 'Origin fetch URLs'
    Assert-ExactlyOneString `
        -Actual $originPushUrls `
        -Expected $script:ExpectedOriginUrl `
        -Label 'Origin push URLs'
    Assert-ExactlyOneString `
        -Actual $legacyFetchUrls `
        -Expected $script:ExpectedLegacyFetchUrl `
        -Label 'Legacy fetch URLs'
    Assert-ExactlyOneString `
        -Actual $legacyPushUrls `
        -Expected $script:ExpectedLegacyPushUrl `
        -Label 'Legacy push URLs'
    Assert-ExactString `
        -Actual $upstream `
        -Expected $script:ExpectedUpstream `
        -Label 'Active branch upstream'

    $remoteHeadText = Invoke-GitText `
        -RepositoryRoot $repositoryRoot `
        -ArgumentList @(
            'ls-remote',
            '--exit-code',
            'origin',
            "refs/heads/$($script:ExpectedBranch)"
        ) `
        -Label 'Hosted branch inspection'
    $remoteHeadLines = Convert-TextToLines -Text $remoteHeadText
    if ($remoteHeadLines.Count -ne 1) {
        Throw-VerificationFailure 'Hosted branch inspection did not return exactly one ref.'
    }
    $remoteHeadParts = @($remoteHeadLines[0] -split "`t", 2)
    if ($remoteHeadParts.Count -ne 2 -or
        $remoteHeadParts[1] -cne "refs/heads/$($script:ExpectedBranch)") {
        Throw-VerificationFailure 'Hosted branch inspection returned an unexpected ref.'
    }
    $remoteHead = [string]$remoteHeadParts[0]
    Assert-LowercaseFullSha -Value $remoteHead -Label 'Hosted branch SHA'
    Assert-ExactString `
        -Actual $remoteHead `
        -Expected $LiveCandidateSha `
        -Label 'Hosted branch SHA'

    $repository = Invoke-GhApiJson `
        -Endpoint "repos/$($script:RepositoryName)" `
        -Label 'GitHub repository inspection'
    Assert-ExactString `
        -Actual ([string]$repository.full_name) `
        -Expected $script:RepositoryName `
        -Label 'GitHub repository'
    if ($repository.private -ne $true) {
        Throw-VerificationFailure 'The GitHub repository must remain private.'
    }
    Assert-ExactString `
        -Actual ([string]$repository.default_branch) `
        -Expected 'main' `
        -Label 'GitHub default branch'

    $mainRef = Invoke-GhApiJson `
        -Endpoint "repos/$($script:RepositoryName)/git/ref/heads/main" `
        -Label 'GitHub main ref inspection'
    $mainSha = [string]$mainRef.object.sha
    Assert-LowercaseFullSha -Value $mainSha -Label 'Hosted main SHA'
    Assert-ExactString `
        -Actual $mainSha `
        -Expected $LiveExpectedMainSha `
        -Label 'GitHub main SHA'

    $escapedBranch = [uri]::EscapeDataString($script:ExpectedBranch)
    $runResponse = Invoke-GhApiJson `
        -Endpoint (
            "repos/$($script:RepositoryName)/actions/runs" +
            "?branch=$escapedBranch&head_sha=$LiveCandidateSha&per_page=100"
        ) `
        -Label 'GitHub workflow run inspection'
    $workflowRuns = @($runResponse.workflow_runs)
    $reportedRunCount = ConvertTo-NonNegativeInt64 `
        -Value $runResponse.total_count `
        -Label 'Reported workflow run count'
    if ($reportedRunCount -ne $workflowRuns.Count) {
        Throw-VerificationFailure 'The exact-candidate workflow run result was not fully bounded.'
    }

    $candidateRuns = @(
        $workflowRuns |
            Where-Object {
                ([string]$_.head_sha) -ceq $LiveCandidateSha -and
                ([string]$_.head_branch) -ceq $script:ExpectedBranch -and
                ([string]$_.path) -ceq $script:ExpectedWorkflowPath
            }
    )
    if ($candidateRuns.Count -eq 0) {
        Throw-VerificationFailure 'No exact-candidate CI workflow run was found.'
    }

    $selectedRun = $candidateRuns |
        Sort-Object -Property @{
            Expression = { [long]$_.id }
            Descending = $true
        } |
        Select-Object -First 1

    $selectedRunId = ConvertTo-NonNegativeInt64 `
        -Value $selectedRun.id `
        -Label 'Workflow run ID'
    if ($selectedRunId -eq 0) {
        Throw-VerificationFailure 'The workflow run ID must be nonzero.'
    }

    Assert-ExactString `
        -Actual ([string]$selectedRun.name) `
        -Expected $script:ExpectedWorkflowName `
        -Label 'Workflow name'
    Assert-ExactString `
        -Actual ([string]$selectedRun.path) `
        -Expected $script:ExpectedWorkflowPath `
        -Label 'Workflow path'
    Assert-ExactString `
        -Actual ([string]$selectedRun.head_branch) `
        -Expected $script:ExpectedBranch `
        -Label 'Workflow branch'
    Assert-ExactString `
        -Actual ([string]$selectedRun.head_sha) `
        -Expected $LiveCandidateSha `
        -Label 'Workflow head SHA'
    Assert-ExactString `
        -Actual ([string]$selectedRun.status) `
        -Expected 'completed' `
        -Label 'Workflow status'
    Assert-ExactString `
        -Actual ([string]$selectedRun.conclusion) `
        -Expected 'success' `
        -Label 'Workflow conclusion'
    Assert-ValidRunUrl -Value ([string]$selectedRun.html_url) -RunId $selectedRunId

    $jobsResponse = Invoke-GhApiJson `
        -Endpoint (
            "repos/$($script:RepositoryName)/actions/runs/$selectedRunId/jobs" +
            '?filter=latest&per_page=100'
        ) `
        -Label 'GitHub workflow job inspection'
    $jobs = @(
        foreach ($job in @($jobsResponse.jobs)) {
            [pscustomobject]@{
                Name = [string]$job.name
                Status = [string]$job.status
                Conclusion = [string]$job.conclusion
            }
        }
    )

    return [pscustomobject]@{
        CandidateSha = $LiveCandidateSha
        ExpectedMainSha = $LiveExpectedMainSha
        HeadDetached = $headDetached
        LocalBranch = $localBranch
        LocalHeadSha = $localHead
        GitStatus = $gitStatus
        RemoteNames = $remoteNames
        OriginFetchUrls = $originFetchUrls
        OriginPushUrls = $originPushUrls
        LegacyFetchUrls = $legacyFetchUrls
        LegacyPushUrls = $legacyPushUrls
        Upstream = $upstream
        RemoteHeadSha = $remoteHead
        RepositoryFullName = [string]$repository.full_name
        RepositoryPrivate = $repository.private
        DefaultBranch = [string]$repository.default_branch
        MainSha = $mainSha
        WorkflowName = [string]$selectedRun.name
        WorkflowPath = [string]$selectedRun.path
        WorkflowBranch = [string]$selectedRun.head_branch
        WorkflowHeadSha = [string]$selectedRun.head_sha
        WorkflowStatus = [string]$selectedRun.status
        WorkflowConclusion = [string]$selectedRun.conclusion
        RunId = $selectedRunId
        RunUrl = [string]$selectedRun.html_url
        ReportedJobCount = $jobsResponse.total_count
        Jobs = $jobs
    }
}

try {
    if ($SelfTest) {
        $selfTestReceipt = Invoke-SelfTest
        [Console]::Out.WriteLine(
            ($selfTestReceipt | ConvertTo-Json -Depth 8 -Compress)
        )
        exit 0
    }

    if ([string]::IsNullOrEmpty($CandidateSha) -or
        [string]::IsNullOrEmpty($ExpectedMainSha)) {
        Throw-VerificationFailure (
            'Live verification requires both CandidateSha and ExpectedMainSha.'
        )
    }

    $liveEvidence = Get-LiveEvidence `
        -LiveCandidateSha $CandidateSha `
        -LiveExpectedMainSha $ExpectedMainSha
    $verified = Test-P0aEvidence -Evidence $liveEvidence
    $receipt = [ordered]@{
        schema = 'blockxone.p0a.hosted.v1'
        result = 'passed'
        verifiedAtUtc = [DateTimeOffset]::UtcNow.ToString(
            'o',
            [System.Globalization.CultureInfo]::InvariantCulture
        )
        evidence = $verified
    }
    [Console]::Out.WriteLine(($receipt | ConvertTo-Json -Depth 12 -Compress))
    exit 0
}
catch {
    [Console]::Error.WriteLine(
        'verify-p0a-hosted: FAIL: {0}',
        $_.Exception.Message
    )
    exit 1
}
