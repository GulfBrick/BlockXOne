[CmdletBinding()]
param(
    [switch]$AssertActionlintVersion,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-ActionlintVersionText {
    param([AllowNull()][string[]]$VersionOutput)

    Assert-Condition (
        $null -ne $VersionOutput -and $VersionOutput.Count -gt 0
    ) 'actionlint version output is missing'
    Assert-Condition (
        $VersionOutput[0].Trim() -ceq 'v1.7.12'
    ) "actionlint version must be exactly v1.7.12; first line was '$($VersionOutput[0])'"
}

function Assert-ActionlintFixture {
    param(
        [bool]$BinaryFound,
        [AllowNull()][string[]]$VersionOutput
    )

    Assert-Condition $BinaryFound 'actionlint binary is missing from PATH'
    Assert-ActionlintVersionText $VersionOutput
}

function Invoke-ActionlintVersionGuard {
    $command = Get-Command actionlint -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        Assert-ActionlintFixture $false @()
    }

    $versionOutput = @(& $command.Source -version 2>&1)
    Assert-Condition ($LASTEXITCODE -eq 0) 'actionlint -version failed'
    Assert-ActionlintFixture $true $versionOutput
}

function Get-WorkflowInspection {
    param([string]$YamlText)

    $token = [guid]::NewGuid().ToString('N')
    $temporaryRoot = [IO.Path]::GetTempPath()
    $helperPath = Join-Path $temporaryRoot "blockxone-ci-uses-$token.go"
    $workflowPath = Join-Path $temporaryRoot "blockxone-ci-workflow-$token.yml"
    $errorPath = Join-Path $temporaryRoot "blockxone-ci-uses-$token.stderr"
    $helperSource = @'
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"gopkg.in/yaml.v3"
)

type stepInspection struct {
	Index                  int    `json:"index"`
	Name                   string `json:"name"`
	Run                    string `json:"run"`
	HasRun                 bool   `json:"hasRun"`
	If                     string `json:"if"`
	HasIf                  bool   `json:"hasIf"`
	HasContinueOnError     bool   `json:"hasContinueOnError"`
	Shell                  string `json:"shell"`
	HasShell               bool   `json:"hasShell"`
	WorkingDirectory       string `json:"workingDirectory"`
	HasWorkingDirectory    bool   `json:"hasWorkingDirectory"`
	Uses                   string `json:"uses"`
	HasUses                bool   `json:"hasUses"`
	With                   map[string]string `json:"with"`
	HasWith                bool   `json:"hasWith"`
	Fields                 []string `json:"fields"`
}

type serviceInspection struct {
	ID      string            `json:"id"`
	Image   string            `json:"image"`
	Env     map[string]string `json:"env"`
	Ports   []string          `json:"ports"`
	Options string            `json:"options"`
	Fields  []string          `json:"fields"`
}

type jobInspection struct {
	ID                     string           `json:"id"`
	Name                   string           `json:"name"`
	RunsOn                 string           `json:"runsOn"`
	TimeoutMinutes         string           `json:"timeoutMinutes"`
	HasIf                  bool             `json:"hasIf"`
	HasContinueOnError     bool             `json:"hasContinueOnError"`
	HasDefaults            bool             `json:"hasDefaults"`
	HasUses                bool             `json:"hasUses"`
	Env                    map[string]string `json:"env"`
	Needs                  []string         `json:"needs"`
	Services               []serviceInspection `json:"services"`
	Steps                  []stepInspection `json:"steps"`
	Fields                 []string         `json:"fields"`
}

type workflowInspection struct {
	Name         string               `json:"name"`
	Uses        []string            `json:"uses"`
	HasDefaults bool                `json:"hasDefaults"`
	Env         map[string]string   `json:"env"`
	Permissions map[string]string   `json:"permissions"`
	Concurrency map[string]string   `json:"concurrency"`
	OnFields    []string            `json:"onFields"`
	PushFields  []string            `json:"pushFields"`
	PushBranches []string           `json:"pushBranches"`
	PullRequestFields []string      `json:"pullRequestFields"`
	PullRequestBranches []string    `json:"pullRequestBranches"`
	HasWorkflowDispatch bool        `json:"hasWorkflowDispatch"`
	Fields      []string            `json:"fields"`
	Jobs        []jobInspection     `json:"jobs"`
}

func dereference(node *yaml.Node) *yaml.Node {
	seen := map[*yaml.Node]struct{}{}
	for node != nil && node.Kind == yaml.AliasNode {
		if _, exists := seen[node]; exists {
			return nil
		}
		seen[node] = struct{}{}
		node = node.Alias
	}
	return node
}

func scalarKey(node *yaml.Node) (string, bool) {
	node = dereference(node)
	if node == nil || node.Kind != yaml.ScalarNode {
		return "", false
	}
	return node.Value, true
}

func scalarValue(node *yaml.Node) (string, bool) {
	return scalarKey(node)
}

func mappingFields(node *yaml.Node, label string) (map[string]*yaml.Node, error) {
	node = dereference(node)
	if node == nil || node.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%s must be a mapping", label)
	}
	fields := map[string]*yaml.Node{}
	for index := 0; index+1 < len(node.Content); index += 2 {
		key, ok := scalarKey(node.Content[index])
		if !ok {
			return nil, fmt.Errorf("%s contains a non-scalar key", label)
		}
		if _, exists := fields[key]; exists {
			return nil, fmt.Errorf("%s contains duplicate key %q", label, key)
		}
		fields[key] = node.Content[index+1]
	}
	return fields, nil
}

func optionalScalar(fields map[string]*yaml.Node, key, label string) (string, bool, error) {
	node, exists := fields[key]
	if !exists {
		return "", false, nil
	}
	value, ok := scalarValue(node)
	if !ok {
		return "", true, fmt.Errorf("%s.%s must be a scalar", label, key)
	}
	return value, true, nil
}

func sortedFieldNames(fields map[string]*yaml.Node) []string {
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func parseScalarMap(node *yaml.Node, label string) (map[string]string, error) {
	if node == nil {
		return map[string]string{}, nil
	}
	fields, err := mappingFields(node, label)
	if err != nil {
		return nil, err
	}
	values := map[string]string{}
	for key, valueNode := range fields {
		value, ok := scalarValue(valueNode)
		if !ok {
			return nil, fmt.Errorf("%s.%s must be a scalar", label, key)
		}
		values[key] = value
	}
	return values, nil
}

func parseScalarList(node *yaml.Node, label string) ([]string, error) {
	if node == nil {
		return []string{}, nil
	}
	node = dereference(node)
	if node == nil || node.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("%s must be a sequence", label)
	}
	values := []string{}
	for _, child := range node.Content {
		value, ok := scalarValue(child)
		if !ok {
			return nil, fmt.Errorf("%s must contain only scalars", label)
		}
		values = append(values, value)
	}
	return values, nil
}

func rejectWorkflowAliasesAndMerges(node *yaml.Node) error {
	if node == nil {
		return nil
	}
	if node.Kind == yaml.AliasNode {
		return fmt.Errorf("CI workflow must not use YAML aliases or merge indirection")
	}
	if node.Kind == yaml.MappingNode {
		for index := 0; index+1 < len(node.Content); index += 2 {
			if key, ok := scalarKey(node.Content[index]); ok && key == "<<" {
				return fmt.Errorf("CI workflow must not use YAML merge keys")
			}
		}
	}
	for _, child := range node.Content {
		if err := rejectWorkflowAliasesAndMerges(child); err != nil {
			return err
		}
	}
	return nil
}

func parseNeeds(node *yaml.Node, label string) ([]string, error) {
	if node == nil {
		return []string{}, nil
	}
	node = dereference(node)
	if node == nil {
		return nil, fmt.Errorf("%s.needs contains an invalid alias", label)
	}
	if node.Kind == yaml.ScalarNode {
		return []string{node.Value}, nil
	}
	if node.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("%s.needs must be a scalar or sequence", label)
	}
	needs := []string{}
	for _, child := range node.Content {
		value, ok := scalarValue(child)
		if !ok {
			return nil, fmt.Errorf("%s.needs must contain only scalars", label)
		}
		needs = append(needs, value)
	}
	return needs, nil
}

func inspectWorkflow(document *yaml.Node) (workflowInspection, error) {
	root := dereference(document)
	if root != nil && root.Kind == yaml.DocumentNode && len(root.Content) == 1 {
		root = dereference(root.Content[0])
	}
	if err := rejectWorkflowAliasesAndMerges(root); err != nil {
		return workflowInspection{}, err
	}
	rootFields, err := mappingFields(root, "workflow")
	if err != nil {
		return workflowInspection{}, err
	}
	jobsNode, exists := rootFields["jobs"]
	if !exists {
		return workflowInspection{}, fmt.Errorf("workflow.jobs is missing")
	}
	jobsNode = dereference(jobsNode)
	if jobsNode == nil || jobsNode.Kind != yaml.MappingNode {
		return workflowInspection{}, fmt.Errorf("workflow.jobs must be a mapping")
	}
	workflowName, _, err := optionalScalar(rootFields, "name", "workflow")
	if err != nil {
		return workflowInspection{}, err
	}
	onFields, err := mappingFields(rootFields["on"], "workflow.on")
	if err != nil {
		return workflowInspection{}, err
	}
	pushFields, err := mappingFields(onFields["push"], "workflow.on.push")
	if err != nil {
		return workflowInspection{}, err
	}
	pushBranches, err := parseScalarList(
		pushFields["branches"],
		"workflow.on.push.branches",
	)
	if err != nil {
		return workflowInspection{}, err
	}
	pullRequestFields, err := mappingFields(
		onFields["pull_request"],
		"workflow.on.pull_request",
	)
	if err != nil {
		return workflowInspection{}, err
	}
	pullRequestBranches, err := parseScalarList(
		pullRequestFields["branches"],
		"workflow.on.pull_request.branches",
	)
	if err != nil {
		return workflowInspection{}, err
	}
	_, hasWorkflowDispatch := onFields["workflow_dispatch"]
	workflowEnv, err := parseScalarMap(rootFields["env"], "workflow.env")
	if err != nil {
		return workflowInspection{}, err
	}
	workflowPermissions, err := parseScalarMap(
		rootFields["permissions"],
		"workflow.permissions",
	)
	if err != nil {
		return workflowInspection{}, err
	}
	workflowConcurrency, err := parseScalarMap(
		rootFields["concurrency"],
		"workflow.concurrency",
	)
	if err != nil {
		return workflowInspection{}, err
	}

	inspection := workflowInspection{
		Name:        workflowName,
		HasDefaults: rootFields["defaults"] != nil,
		Env:         workflowEnv,
		Permissions: workflowPermissions,
		Concurrency: workflowConcurrency,
		OnFields:    sortedFieldNames(onFields),
		PushFields:  sortedFieldNames(pushFields),
		PushBranches: pushBranches,
		PullRequestFields: sortedFieldNames(pullRequestFields),
		PullRequestBranches: pullRequestBranches,
		HasWorkflowDispatch: hasWorkflowDispatch,
		Fields:      sortedFieldNames(rootFields),
		Jobs:        []jobInspection{},
	}
	seenJobIDs := map[string]struct{}{}
	for index := 0; index+1 < len(jobsNode.Content); index += 2 {
		jobID, ok := scalarKey(jobsNode.Content[index])
		if !ok || jobID == "" {
			return workflowInspection{}, fmt.Errorf("workflow.jobs contains an invalid job id")
		}
		if _, exists := seenJobIDs[jobID]; exists {
			return workflowInspection{}, fmt.Errorf("workflow.jobs contains duplicate job id %q", jobID)
		}
		seenJobIDs[jobID] = struct{}{}

		jobLabel := "workflow.jobs." + jobID
		jobFields, err := mappingFields(jobsNode.Content[index+1], jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		name, _, err := optionalScalar(jobFields, "name", jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		runsOn, _, err := optionalScalar(jobFields, "runs-on", jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		timeoutMinutes, _, err := optionalScalar(
			jobFields,
			"timeout-minutes",
			jobLabel,
		)
		if err != nil {
			return workflowInspection{}, err
		}
		_, hasIf, err := optionalScalar(jobFields, "if", jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		_, hasContinueOnError, err := optionalScalar(jobFields, "continue-on-error", jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		needs, err := parseNeeds(jobFields["needs"], jobLabel)
		if err != nil {
			return workflowInspection{}, err
		}
		jobEnv, err := parseScalarMap(jobFields["env"], jobLabel+".env")
		if err != nil {
			return workflowInspection{}, err
		}
		services := []serviceInspection{}
		if servicesNode, hasServices := jobFields["services"]; hasServices {
			serviceFields, err := mappingFields(servicesNode, jobLabel+".services")
			if err != nil {
				return workflowInspection{}, err
			}
			serviceIDs := sortedFieldNames(serviceFields)
			for _, serviceID := range serviceIDs {
				serviceLabel := jobLabel + ".services." + serviceID
				fields, err := mappingFields(serviceFields[serviceID], serviceLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				image, _, err := optionalScalar(fields, "image", serviceLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				options, _, err := optionalScalar(fields, "options", serviceLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				env, err := parseScalarMap(fields["env"], serviceLabel+".env")
				if err != nil {
					return workflowInspection{}, err
				}
				ports, err := parseScalarList(fields["ports"], serviceLabel+".ports")
				if err != nil {
					return workflowInspection{}, err
				}
				services = append(services, serviceInspection{
					ID:      serviceID,
					Image:   image,
					Env:     env,
					Ports:   ports,
					Options: options,
					Fields:  sortedFieldNames(fields),
				})
			}
		}
		job := jobInspection{
			ID:                 jobID,
			Name:               name,
			RunsOn:             runsOn,
			TimeoutMinutes:     timeoutMinutes,
			HasIf:              hasIf,
			HasContinueOnError: hasContinueOnError,
			HasDefaults:        jobFields["defaults"] != nil,
			HasUses:            jobFields["uses"] != nil,
			Env:                jobEnv,
			Needs:              needs,
			Services:           services,
			Steps:              []stepInspection{},
			Fields:             sortedFieldNames(jobFields),
		}

		if stepsNode, hasSteps := jobFields["steps"]; hasSteps {
			stepsNode = dereference(stepsNode)
			if stepsNode == nil || stepsNode.Kind != yaml.SequenceNode {
				return workflowInspection{}, fmt.Errorf("%s.steps must be a sequence", jobLabel)
			}
			for stepIndex, stepNode := range stepsNode.Content {
				stepLabel := fmt.Sprintf("%s.steps[%d]", jobLabel, stepIndex)
				stepFields, err := mappingFields(stepNode, stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				name, _, err := optionalScalar(stepFields, "name", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				run, hasRun, err := optionalScalar(stepFields, "run", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				condition, hasIf, err := optionalScalar(stepFields, "if", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				_, hasContinueOnError, err := optionalScalar(stepFields, "continue-on-error", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				shell, hasShell, err := optionalScalar(stepFields, "shell", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				workingDirectory, hasWorkingDirectory, err := optionalScalar(
					stepFields,
					"working-directory",
					stepLabel,
				)
				if err != nil {
					return workflowInspection{}, err
				}
				uses, hasUses, err := optionalScalar(stepFields, "uses", stepLabel)
				if err != nil {
					return workflowInspection{}, err
				}
				withValues, err := parseScalarMap(stepFields["with"], stepLabel+".with")
				if err != nil {
					return workflowInspection{}, err
				}
				job.Steps = append(job.Steps, stepInspection{
					Index:               stepIndex,
					Name:                name,
					Run:                 run,
					HasRun:              hasRun,
					If:                  condition,
					HasIf:               hasIf,
					HasContinueOnError:  hasContinueOnError,
					Shell:               shell,
					HasShell:            hasShell,
					WorkingDirectory:    workingDirectory,
					HasWorkingDirectory: hasWorkingDirectory,
					Uses:                uses,
					HasUses:             hasUses,
					With:                withValues,
					HasWith:             stepFields["with"] != nil,
					Fields:              sortedFieldNames(stepFields),
				})
			}
		}
		inspection.Jobs = append(inspection.Jobs, job)
	}
	return inspection, nil
}

func collectUses(node *yaml.Node, references *[]string) error {
	if node == nil {
		return nil
	}
	if node.Kind == yaml.AliasNode {
		return collectUses(node.Alias, references)
	}
	if node.Kind == yaml.MappingNode {
		for index := 0; index+1 < len(node.Content); index += 2 {
			key := node.Content[index]
			value := node.Content[index+1]
			if decoded, ok := scalarKey(key); ok && decoded == "uses" {
				reference, scalar := scalarValue(value)
				if !scalar {
					return fmt.Errorf("uses value must be a scalar")
				}
				*references = append(*references, reference)
			}
			if err := collectUses(value, references); err != nil {
				return err
			}
		}
		return nil
	}
	for _, child := range node.Content {
		if err := collectUses(child, references); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "expected one workflow path")
		os.Exit(2)
	}
	content, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot read workflow")
		os.Exit(2)
	}
	var document yaml.Node
	if err := yaml.Unmarshal(content, &document); err != nil {
		fmt.Fprintln(os.Stderr, "cannot parse workflow YAML")
		os.Exit(2)
	}
	inspection, err := inspectWorkflow(&document)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(2)
	}
	references := []string{}
	if err := collectUses(&document, &references); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(2)
	}
	inspection.Uses = references
	if err := json.NewEncoder(os.Stdout).Encode(inspection); err != nil {
		fmt.Fprintln(os.Stderr, "cannot encode workflow inspection")
		os.Exit(2)
	}
}
'@

    try {
        $utf8 = [Text.UTF8Encoding]::new($false)
        [IO.File]::WriteAllText($helperPath, $helperSource, $utf8)
        [IO.File]::WriteAllText($workflowPath, $YamlText, $utf8)

        Push-Location $repoRoot
        try {
            $jsonOutput = @(
                & go run -mod=readonly $helperPath $workflowPath 2> $errorPath
            )
            $goExit = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        Assert-Condition (
            $goExit -eq 0
        ) 'structural GitHub Actions YAML inspection failed'

        $json = $jsonOutput -join "`n"
        try {
            $decoded = $json | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw 'structural GitHub Actions YAML inspection returned invalid JSON'
        }
        return $decoded
    }
    finally {
        foreach ($temporaryPath in @($helperPath, $workflowPath, $errorPath)) {
            if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
                [IO.File]::Delete($temporaryPath)
            }
        }
    }
}

function ConvertTo-NormalizedRunText {
    param([AllowNull()][string]$Text)

    if ($null -eq $Text) {
        return ''
    }
    return $Text.Replace("`r`n", "`n").Trim()
}

function Get-RequiredCiJob {
    param(
        [object]$Inspection,
        [string]$JobId,
        [string]$ExpectedName
    )

    $matches = @(
        $Inspection.jobs |
            Where-Object { $_.id -ceq $JobId }
    )
    Assert-Condition (
        $matches.Count -eq 1
    ) "CI must contain exactly one mandatory job id '$JobId'"
    $job = $matches[0]
    Assert-Condition (
        $job.name -ceq $ExpectedName
    ) "mandatory job '$JobId' must be named exactly '$ExpectedName'"
    Assert-Condition (
        -not [bool]$job.hasIf
    ) "mandatory job '$JobId' must not have an if condition"
    Assert-Condition (
        -not [bool]$job.hasContinueOnError
    ) "mandatory job '$JobId' must not use continue-on-error"
    Assert-Condition (
        -not [bool]$job.hasDefaults
    ) "mandatory job '$JobId' must not override run defaults"
    Assert-Condition (
        -not [bool]$job.hasUses
    ) "mandatory job '$JobId' must define concrete steps, not a reusable-workflow indirection"
    Assert-Condition (
        @($job.steps).Count -gt 0
    ) "mandatory job '$JobId' contains no concrete steps"
    return $job
}

function Get-RequiredRunSteps {
    param(
        [object]$Job,
        [string]$Command,
        [int]$ExpectedCount = 1,
        [AllowEmptyString()][string]$ExpectedShell = ''
    )

    $normalizedCommand = ConvertTo-NormalizedRunText $Command
    $matches = @(
        $Job.steps |
            Where-Object {
                [bool]$_.hasRun -and
                (ConvertTo-NormalizedRunText $_.run) -ceq $normalizedCommand
            }
    )
    Assert-Condition (
        $matches.Count -eq $ExpectedCount
    ) "mandatory job '$($Job.id)' must contain exactly $ExpectedCount executable step(s) for: $normalizedCommand"

    foreach ($step in $matches) {
        Assert-Condition (
            -not [bool]$step.hasIf
        ) "mandatory command in job '$($Job.id)' must not have an if condition: $normalizedCommand"
        Assert-Condition (
            -not [bool]$step.hasContinueOnError
        ) "mandatory command in job '$($Job.id)' must not use continue-on-error: $normalizedCommand"
        Assert-Condition (
            -not [bool]$step.hasWorkingDirectory
        ) "mandatory command in job '$($Job.id)' must run from the repository root: $normalizedCommand"
        if ([string]::IsNullOrEmpty($ExpectedShell)) {
            Assert-Condition (
                -not [bool]$step.hasShell
            ) "mandatory command in job '$($Job.id)' must use the default runner shell: $normalizedCommand"
        }
        else {
            Assert-Condition (
                [bool]$step.hasShell -and $step.shell -ceq $ExpectedShell
            ) "mandatory command in job '$($Job.id)' must use shell '$ExpectedShell': $normalizedCommand"
        }
    }
    return $matches
}

function Assert-ExactStringSet {
    param(
        [AllowNull()][object[]]$Actual,
        [string[]]$Expected,
        [string]$Label
    )

    $actualValues = @($Actual | ForEach-Object { [string]$_ })
    $actualSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($value in $actualValues) {
        Assert-Condition (
            $actualSet.Add($value)
        ) "$Label contains duplicate value '$value'"
    }
    $expectedSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($value in $Expected) {
        [void]$expectedSet.Add($value)
    }
    $missing = @($Expected | Where-Object { -not $actualSet.Contains($_) })
    $extra = @($actualValues | Where-Object { -not $expectedSet.Contains($_) })
    Assert-Condition (
        $missing.Count -eq 0 -and $extra.Count -eq 0
    ) "$Label mismatch; missing=[$($missing -join ', ')]; extra=[$($extra -join ', ')]"
}

function Assert-ExactScalarMap {
    param(
        [AllowNull()][object]$Actual,
        [Collections.IDictionary]$Expected,
        [string]$Label
    )

    $actualProperties = if ($null -eq $Actual) {
        @()
    }
    else {
        @($Actual.PSObject.Properties)
    }
    Assert-ExactStringSet `
        -Actual @($actualProperties | ForEach-Object { $_.Name }) `
        -Expected @($Expected.Keys | ForEach-Object { [string]$_ }) `
        -Label "$Label keys"
    foreach ($key in $Expected.Keys) {
        $property = $Actual.PSObject.Properties[[string]$key]
        Assert-Condition (
            $null -ne $property -and
            ([string]$property.Value) -ceq ([string]$Expected[$key])
        ) "$Label value mismatch for '$key'"
    }
}

function Assert-ExactJobEnvelope {
    param(
        [object]$Job,
        [string[]]$Fields,
        [string]$RunsOn,
        [string]$TimeoutMinutes,
        [Collections.IDictionary]$Env,
        [string[]]$Needs = @(),
        [int]$ServiceCount = 0
    )

    Assert-ExactStringSet -Actual @($Job.fields) -Expected $Fields -Label "job '$($Job.id)' fields"
    Assert-Condition ($Job.runsOn -ceq $RunsOn) "job '$($Job.id)' runs-on mismatch"
    Assert-Condition (
        $Job.timeoutMinutes -ceq $TimeoutMinutes
    ) "job '$($Job.id)' timeout-minutes mismatch"
    Assert-ExactScalarMap -Actual $Job.env -Expected $Env -Label "job '$($Job.id)' env"
    Assert-ExactStringSet -Actual @($Job.needs) -Expected $Needs -Label "job '$($Job.id)' needs"
    Assert-Condition (
        @($Job.services).Count -eq $ServiceCount
    ) "job '$($Job.id)' service count mismatch"
}

function Assert-ExactStep {
    param(
        [object]$Actual,
        [int]$Index,
        [ValidateSet('run', 'uses')]
        [string]$Type,
        [AllowEmptyString()][string]$Name = '',
        [AllowEmptyString()][string]$Run = '',
        [AllowEmptyString()][string]$Uses = '',
        [AllowEmptyString()][string]$Shell = '',
        [AllowEmptyString()][string]$WorkingDirectory = '',
        [Collections.IDictionary]$With = @{}
    )

    Assert-Condition ($Actual.index -eq $Index) "step index mismatch at expected index $Index"
    $expectedFields = [Collections.Generic.List[string]]::new()
    [void]$expectedFields.Add($Type)
    if (-not [string]::IsNullOrEmpty($Name)) {
        [void]$expectedFields.Add('name')
    }
    if (-not [string]::IsNullOrEmpty($Shell)) {
        [void]$expectedFields.Add('shell')
    }
    if (-not [string]::IsNullOrEmpty($WorkingDirectory)) {
        [void]$expectedFields.Add('working-directory')
    }
    if ($With.Count -gt 0) {
        [void]$expectedFields.Add('with')
    }
    Assert-ExactStringSet `
        -Actual @($Actual.fields) `
        -Expected @($expectedFields) `
        -Label "step $Index fields"
    Assert-Condition ($Actual.name -ceq $Name) "step $Index name mismatch"
    Assert-Condition ($Actual.shell -ceq $Shell) "step $Index shell mismatch"
    Assert-Condition (
        $Actual.workingDirectory -ceq $WorkingDirectory
    ) "step $Index working-directory mismatch"

    if ($Type -ceq 'run') {
        Assert-Condition (
            [bool]$Actual.hasRun -and -not [bool]$Actual.hasUses
        ) "step $Index must be exactly a run step"
        Assert-Condition (
            (ConvertTo-NormalizedRunText $Actual.run) -ceq
            (ConvertTo-NormalizedRunText $Run)
        ) "step $Index run command mismatch"
        Assert-ExactScalarMap -Actual $Actual.with -Expected @{} -Label "step $Index with"
    }
    else {
        Assert-Condition (
            [bool]$Actual.hasUses -and -not [bool]$Actual.hasRun
        ) "step $Index must be exactly an action step"
        Assert-Condition ($Actual.uses -ceq $Uses) "step $Index action reference mismatch"
        Assert-ExactScalarMap -Actual $Actual.with -Expected $With -Label "step $Index with"
    }
}

function Assert-MandatoryCiStructure {
    param([object]$Inspection)

    Assert-Condition (
        -not [bool]$Inspection.hasDefaults
    ) 'CI workflow must not override run defaults for mandatory jobs'

    $jobNames = [ordered]@{
        planning = 'Planning and production policy'
        go = 'Go build, test, vet and lint'
        migrations = 'Clean and current-schema migration smoke tests'
        web = 'Web install, test, lint and build'
        contracts = 'Contract compile and test'
        security = 'Mandatory source and dependency security gates'
        images = 'Build container candidates without publishing'
    }
    $jobs = @{}
    foreach ($entry in $jobNames.GetEnumerator()) {
        $jobs[$entry.Key] = Get-RequiredCiJob `
            -Inspection $Inspection `
            -JobId $entry.Key `
            -ExpectedName $entry.Value
    }

    Assert-ExactStringSet `
        -Actual @($Inspection.jobs | ForEach-Object { $_.id }) `
        -Expected @('planning', 'go', 'migrations', 'web', 'contracts', 'security', 'images') `
        -Label 'CI mandatory job ids'
    Assert-ExactStringSet `
        -Actual @($Inspection.fields) `
        -Expected @('name', 'on', 'permissions', 'concurrency', 'env', 'jobs') `
        -Label 'CI workflow fields'
    Assert-Condition ($Inspection.name -ceq 'CI') 'CI workflow name must be exactly CI'
    Assert-ExactStringSet `
        -Actual @($Inspection.onFields) `
        -Expected @('push', 'pull_request', 'workflow_dispatch') `
        -Label 'CI workflow trigger fields'
    Assert-ExactStringSet `
        -Actual @($Inspection.pushFields) `
        -Expected @('branches') `
        -Label 'CI push trigger fields'
    Assert-ExactStringSet `
        -Actual @($Inspection.pushBranches) `
        -Expected @('main', 'develop', 'codex/functional-platform') `
        -Label 'CI push branches'
    Assert-ExactStringSet `
        -Actual @($Inspection.pullRequestFields) `
        -Expected @('branches') `
        -Label 'CI pull-request trigger fields'
    Assert-ExactStringSet `
        -Actual @($Inspection.pullRequestBranches) `
        -Expected @('main', 'develop') `
        -Label 'CI pull-request branches'
    Assert-Condition (
        [bool]$Inspection.hasWorkflowDispatch
    ) 'CI must contain workflow_dispatch'
    Assert-ExactScalarMap `
        -Actual $Inspection.env `
        -Expected ([ordered]@{
            GO_VERSION = '1.26.5'
            NODE_VERSION = '22.23.1'
        }) `
        -Label 'CI workflow env'
    Assert-ExactScalarMap `
        -Actual $Inspection.permissions `
        -Expected ([ordered]@{ contents = 'read' }) `
        -Label 'CI workflow permissions'
    Assert-ExactScalarMap `
        -Actual $Inspection.concurrency `
        -Expected ([ordered]@{
            group = '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}'
            'cancel-in-progress' = 'true'
        }) `
        -Label 'CI workflow concurrency'

    Assert-ExactJobEnvelope $jobs.planning `
        @('name', 'runs-on', 'timeout-minutes', 'steps') `
        'ubuntu-latest' '10' @{}
    Assert-ExactJobEnvelope $jobs.go `
        @('name', 'runs-on', 'timeout-minutes', 'steps') `
        'ubuntu-latest' '25' @{}
    Assert-ExactJobEnvelope $jobs.migrations `
        @('name', 'runs-on', 'timeout-minutes', 'services', 'env', 'steps') `
        'ubuntu-latest' '15' `
        ([ordered]@{
            APP_ENV = 'test'
            DATABASE_URL = 'postgres://blockxone_ci:blockxone_ci@127.0.0.1:5432/blockxone?sslmode=disable'
        }) @() 1
    Assert-ExactJobEnvelope $jobs.web `
        @('name', 'runs-on', 'timeout-minutes', 'env', 'steps') `
        'ubuntu-latest' '25' `
        ([ordered]@{
            NEXT_PUBLIC_API_URL = 'https://api.blockxone.example'
            SERVER_ACTION_ALLOWED_ORIGINS = 'app.blockxone.example'
        })
    Assert-ExactJobEnvelope $jobs.contracts `
        @('name', 'runs-on', 'timeout-minutes', 'steps') `
        'ubuntu-latest' '25' @{}
    Assert-ExactJobEnvelope $jobs.security `
        @('name', 'runs-on', 'timeout-minutes', 'steps') `
        'ubuntu-latest' '25' @{}
    Assert-ExactJobEnvelope $jobs.images `
        @('name', 'runs-on', 'timeout-minutes', 'needs', 'steps') `
        'ubuntu-latest' '35' @{} `
        @('planning', 'go', 'migrations', 'web', 'contracts', 'security')

    $postgresService = @($jobs.migrations.services)[0]
    Assert-Condition ($postgresService.id -ceq 'postgres') 'migration service id must be postgres'
    Assert-ExactStringSet `
        -Actual @($postgresService.fields) `
        -Expected @('image', 'env', 'ports', 'options') `
        -Label 'postgres service fields'
    Assert-Condition (
        $postgresService.image -ceq 'postgres:16'
    ) 'postgres service image mismatch'
    Assert-ExactScalarMap `
        -Actual $postgresService.env `
        -Expected ([ordered]@{
            POSTGRES_USER = 'blockxone_ci'
            POSTGRES_PASSWORD = 'blockxone_ci'
            POSTGRES_DB = 'blockxone'
        }) `
        -Label 'postgres service env'
    Assert-ExactStringSet `
        -Actual @($postgresService.ports) `
        -Expected @('5432:5432') `
        -Label 'postgres service ports'
    Assert-Condition (
        (ConvertTo-NormalizedRunText $postgresService.options) -ceq
        '--health-cmd "pg_isready -U blockxone_ci -d blockxone" --health-interval 5s --health-timeout 5s --health-retries 10'
    ) 'postgres service options mismatch'

    $checkout = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
    $setupGo = 'actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff'
    $setupNode = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
    $setupGoWith = [ordered]@{
        'go-version' = '${{ env.GO_VERSION }}'
        'cache-dependency-path' = 'go.sum'
    }
    $setupNodeWebWith = [ordered]@{
        'node-version' = '${{ env.NODE_VERSION }}'
        cache = 'npm'
        'cache-dependency-path' = 'apps/web/package-lock.json'
    }
    $setupNodeContractsWith = [ordered]@{
        'node-version' = '${{ env.NODE_VERSION }}'
        cache = 'npm'
        'cache-dependency-path' = 'contracts/package-lock.json'
    }

    $actionlintRun = @'
go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
$goBin = Join-Path (go env GOPATH) 'bin'
$env:PATH = "$goBin$([IO.Path]::PathSeparator)$env:PATH"
./.planning/scripts/validate-ci-policy.ps1 -AssertActionlintVersion
actionlint .github/workflows/ci.yml .github/workflows/deploy.yml
'@

    Assert-Condition (@($jobs.planning.steps).Count -eq 7) 'planning step count mismatch'
    Assert-ExactStep $jobs.planning.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.planning.steps[1] 1 uses -Uses $setupGo -With (
        [ordered]@{
            'go-version' = '${{ env.GO_VERSION }}'
            cache = 'false'
        }
    )
    Assert-ExactStep $jobs.planning.steps[2] 2 run `
        -Name 'Install and verify pinned actionlint' -Run $actionlintRun -Shell 'pwsh'
    Assert-ExactStep $jobs.planning.steps[3] 3 run `
        -Name 'Validate planning truth' `
        -Run './.planning/scripts/validate-planning.ps1 -ResidueMode CleanCandidate' `
        -Shell 'pwsh'
    Assert-ExactStep $jobs.planning.steps[4] 4 run `
        -Name 'Reject prohibited repository artifacts and contaminated branch history' `
        -Run './.planning/scripts/validate-repository-artifacts.ps1' -Shell 'pwsh'
    Assert-ExactStep $jobs.planning.steps[5] 5 run `
        -Name 'Validate production Compose contract' `
        -Run './.planning/scripts/validate-production-compose.ps1' -Shell 'pwsh'
    Assert-ExactStep $jobs.planning.steps[6] 6 run `
        -Name 'Validate mandatory CI and deployment failure policy' `
        -Run './.planning/scripts/validate-ci-policy.ps1' -Shell 'pwsh'

    Assert-Condition (@($jobs.go.steps).Count -eq 8) 'go step count mismatch'
    Assert-ExactStep $jobs.go.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.go.steps[1] 1 uses -Uses $setupGo -With $setupGoWith
    Assert-ExactStep $jobs.go.steps[2] 2 run -Run 'go mod download'
    Assert-ExactStep $jobs.go.steps[3] 3 run `
        -Run 'go test -race -coverprofile=coverage.out -covermode=atomic ./cmd/... ./internal/... ./scripts/...'
    Assert-ExactStep $jobs.go.steps[4] 4 run `
        -Run 'go vet ./cmd/... ./internal/... ./scripts/...'
    Assert-ExactStep $jobs.go.steps[5] 5 run `
        -Name 'Install pinned golangci-lint' `
        -Run 'go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2'
    Assert-ExactStep $jobs.go.steps[6] 6 run `
        -Run 'golangci-lint run --timeout 5m ./cmd/... ./internal/... ./scripts/...'
    Assert-ExactStep $jobs.go.steps[7] 7 run `
        -Run 'go build ./cmd/api ./cmd/worker ./cmd/migrate ./cmd/seed'

    Assert-Condition (@($jobs.migrations.steps).Count -eq 4) 'migration step count mismatch'
    Assert-ExactStep $jobs.migrations.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.migrations.steps[1] 1 uses -Uses $setupGo -With $setupGoWith
    Assert-ExactStep $jobs.migrations.steps[2] 2 run `
        -Name 'Apply all migrations to a clean schema' -Run 'go run ./cmd/migrate'
    Assert-ExactStep $jobs.migrations.steps[3] 3 run `
        -Name 'Re-run migrations against the current schema' -Run 'go run ./cmd/migrate'

    $missingApiRun = @'
if NODE_ENV=production NEXT_PUBLIC_API_URL= node -e "require('./apps/web/next.config.js')"; then
  echo "Production web configuration accepted a missing NEXT_PUBLIC_API_URL"
  exit 1
fi
'@
    $missingOriginsRun = @'
if NODE_ENV=production NEXT_PUBLIC_API_URL=https://api.blockxone.example SERVER_ACTION_ALLOWED_ORIGINS= node -e "require('./apps/web/next.config.js')"; then
  echo "Production web configuration accepted missing SERVER_ACTION_ALLOWED_ORIGINS"
  exit 1
fi
'@
    Assert-Condition (@($jobs.web.steps).Count -eq 13) 'web step count mismatch'
    Assert-ExactStep $jobs.web.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.web.steps[1] 1 uses -Uses $setupNode -With $setupNodeWebWith
    Assert-ExactStep $jobs.web.steps[2] 2 run -Run 'npm ci --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[3] 3 run -Run 'npm run test:preflight --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[4] 4 run -Run 'npm run test:config --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[5] 5 run `
        -Name 'Exercise the controlled web-test runner and its hostile-environment cases' `
        -Run 'npm run test:runner --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[6] 6 run -Run 'npm test --prefix apps/web -- --run'
    Assert-ExactStep $jobs.web.steps[7] 7 run `
        -Name 'Re-run the same controlled test set from the package root' `
        -Run 'npm test -- --run' -WorkingDirectory 'apps/web'
    Assert-ExactStep $jobs.web.steps[8] 8 run -Run 'npm run lint --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[9] 9 run `
        -Name 'Prove production web config fails without its public API contract' `
        -Run $missingApiRun -Shell 'bash'
    Assert-ExactStep $jobs.web.steps[10] 10 run `
        -Name 'Prove production web config fails without server-action origins' `
        -Run $missingOriginsRun -Shell 'bash'
    Assert-ExactStep $jobs.web.steps[11] 11 run -Run 'npm run build --prefix apps/web'
    Assert-ExactStep $jobs.web.steps[12] 12 run `
        -Name 'Probe production route containment and middleware-bypass regression' `
        -Run 'npm run test:production-containment --prefix apps/web'

    Assert-Condition (@($jobs.contracts.steps).Count -eq 7) 'contract step count mismatch'
    Assert-ExactStep $jobs.contracts.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.contracts.steps[1] 1 uses `
        -Uses $setupNode -With $setupNodeContractsWith
    Assert-ExactStep $jobs.contracts.steps[2] 2 run `
        -Run 'npm ci --ignore-scripts --prefix contracts'
    Assert-ExactStep $jobs.contracts.steps[3] 3 run `
        -Run 'npm run test:preflight --prefix contracts'
    Assert-ExactStep $jobs.contracts.steps[4] 4 run -Run 'npm run compile --prefix contracts'
    Assert-ExactStep $jobs.contracts.steps[5] 5 run -Run 'npm run typecheck --prefix contracts'
    Assert-ExactStep $jobs.contracts.steps[6] 6 run -Run 'npm test --prefix contracts'

    Assert-Condition (@($jobs.security.steps).Count -eq 9) 'security step count mismatch'
    Assert-ExactStep $jobs.security.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.security.steps[1] 1 uses -Uses $setupGo -With $setupGoWith
    Assert-ExactStep $jobs.security.steps[2] 2 uses -Uses $setupNode -With (
        [ordered]@{ 'node-version' = '${{ env.NODE_VERSION }}' }
    )
    Assert-ExactStep $jobs.security.steps[3] 3 run `
        -Name 'Install pinned gosec' `
        -Run 'go install github.com/securego/gosec/v2/cmd/gosec@v2.25.0'
    Assert-ExactStep $jobs.security.steps[4] 4 run `
        -Name 'Install pinned govulncheck' `
        -Run 'go install golang.org/x/vuln/cmd/govulncheck@v1.6.0'
    Assert-ExactStep $jobs.security.steps[5] 5 run `
        -Name 'Run gosec and fail on findings' `
        -Run 'gosec -tests -severity medium -confidence medium ./cmd/... ./internal/...'
    Assert-ExactStep $jobs.security.steps[6] 6 run `
        -Name 'Scan reachable Go dependency vulnerabilities and fail on findings' `
        -Run 'govulncheck ./cmd/... ./internal/... ./scripts/...'
    Assert-ExactStep $jobs.security.steps[7] 7 run `
        -Name 'Audit web dependencies and fail at moderate severity' `
        -Run 'npm audit --prefix apps/web --audit-level=moderate'
    Assert-ExactStep $jobs.security.steps[8] 8 run `
        -Name 'Audit contract dependencies and fail at moderate severity' `
        -Run 'npm audit --prefix contracts --audit-level=moderate'

    Assert-Condition (@($jobs.images.steps).Count -eq 4) 'image step count mismatch'
    Assert-ExactStep $jobs.images.steps[0] 0 uses -Uses $checkout
    Assert-ExactStep $jobs.images.steps[1] 1 run `
        -Run 'docker build --file Dockerfile.api --tag blockxone-api:${{ github.sha }} .'
    Assert-ExactStep $jobs.images.steps[2] 2 run `
        -Run 'docker build --file Dockerfile.worker --tag blockxone-worker:${{ github.sha }} .'
    Assert-ExactStep $jobs.images.steps[3] 3 run `
        -Run 'docker build --file Dockerfile.web --tag blockxone-web:${{ github.sha }} .'
}

function Assert-PolicyDocuments {
    param(
        [string]$Ci,
        [string]$Deploy,
        [string]$Makefile,
        [string]$Codeowners,
        [string]$Dependabot,
        [string]$ApiDockerfile,
        [string]$Dockerignore
    )

    $combined = @($Ci, $Deploy, $Makefile) -join "`n"
    foreach ($forbidden in @(
        '\|\|\s*true',
        '(?<![A-Za-z])-no-fail(?![A-Za-z])',
        'continue-on-error:\s*true',
        'fail_ci_if_error:\s*false'
    )) {
        Assert-Condition (
            $combined -notmatch $forbidden
        ) "mandatory delivery path contains fail-open pattern: $forbidden"
    }

    Assert-Condition (
        [regex]::IsMatch(
            $Ci,
            '(?ms)^  push:\s*\r?\n(?:(?!^  [A-Za-z0-9_-]+:).)*?^    branches:\s*\[[^\]]*codex/functional-platform[^\]]*\]'
        )
    ) 'CI push trigger must include codex/functional-platform'
    Assert-Condition (
        [regex]::IsMatch($Ci, '(?m)^  workflow_dispatch:\s*$')
    ) 'CI must retain a manual workflow_dispatch trigger'

    $workflowInspection = Get-WorkflowInspection -YamlText $Ci
    Assert-MandatoryCiStructure -Inspection $workflowInspection

    $allowedUses = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($allowed in @(
        'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
        'actions/setup-go@40f1582b2485089dde7abd97c1529aa768e1baff',
        'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'
    )) {
        [void]$allowedUses.Add($allowed)
    }

    $usesReferences = @($workflowInspection.uses)
    Assert-Condition ($usesReferences.Count -gt 0) 'CI contains no action or reusable-workflow references'
    foreach ($reference in $usesReferences) {
        Assert-Condition (
            $reference -cmatch '^[^/\s]+/[^@\s]+@[0-9a-f]{40}$'
        ) "external action is not pinned to a full lowercase commit SHA: $reference"
        Assert-Condition (
            $allowedUses.Contains($reference)
        ) "external action is not on the approved pin list: $reference"
    }

    Assert-Condition (
        $ApiDockerfile -match '(?m)^COPY --chown=appuser:appuser migrations /home/appuser/migrations\s*$'
    ) 'Dockerfile.api must copy migrations into the runtime image used by the migrate entrypoint'
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
        Assert-Condition (
            $Dockerignore.Contains($requiredIgnore)
        ) "Docker build context does not exclude prohibited material: $requiredIgnore"
    }

    Assert-Condition (
        $Deploy -match '(?m)^\s*exit 1\s*$' -and
        $Deploy -match 'intentionally blocked'
    ) 'deployment workflow must explicitly fail until real deployment controls exist'
    Assert-Condition (
        $Deploy -notmatch '(?i)successfully deployed|notify deployment success'
    ) 'blocked deployment workflow must not publish success evidence'
    Assert-Condition (
        $Makefile -match '(?ms)^rollback:.*?^\s*@exit 1\s*$'
    ) 'rollback command must explicitly fail until a verified recovery procedure exists'

    $ownerLines = @(
        $Codeowners -split '\r?\n' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') }
    )
    Assert-Condition ($ownerLines.Count -gt 0) 'CODEOWNERS contains no ownership rules'
    $ownerPatterns = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($line in $ownerLines) {
        $parts = @($line -split '\s+' | Where-Object { $_ })
        Assert-Condition ($parts.Count -ge 2) "invalid CODEOWNERS rule: $line"
        [void]$ownerPatterns.Add($parts[0])
        foreach ($owner in $parts[1..($parts.Count - 1)]) {
            Assert-Condition (
                $owner -ceq '@GulfBrick'
            ) "CODEOWNERS contains an unapproved or invalid principal: $owner"
        }
    }
    foreach ($requiredPattern in @('*', '/.github/', '/.planning/', '/migrations/', '/contracts/')) {
        Assert-Condition (
            $ownerPatterns.Contains($requiredPattern)
        ) "CODEOWNERS is missing required pattern: $requiredPattern"
    }

    Assert-Condition (
        [regex]::IsMatch($Dependabot, '(?m)^version:\s*2\s*$')
    ) 'Dependabot configuration must use version 2'
    $dependabotBlocks = [regex]::Matches(
        $Dependabot,
        '(?ms)^\s{2}- package-ecosystem:\s*"(?<ecosystem>[^"]+)"\s*\r?\n(?<body>.*?)(?=^\s{2}- package-ecosystem:|\z)'
    )
    Assert-Condition (
        $dependabotBlocks.Count -eq 5
    ) "Dependabot must define exactly five update blocks; found $($dependabotBlocks.Count)"
    $actualDependabot = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($block in $dependabotBlocks) {
        $ecosystem = $block.Groups['ecosystem'].Value
        $body = $block.Groups['body'].Value
        $directoryMatch = [regex]::Match($body, '(?m)^\s{4}directory:\s*"(?<directory>[^"]+)"\s*$')
        Assert-Condition $directoryMatch.Success "Dependabot $ecosystem block is missing an exact directory"
        $key = "$ecosystem|$($directoryMatch.Groups['directory'].Value)"
        Assert-Condition (
            $actualDependabot.Add($key)
        ) "Dependabot contains a duplicate update block: $key"
        Assert-Condition (
            [regex]::IsMatch($body, '(?m)^\s{6}interval:\s*"weekly"\s*$')
        ) "Dependabot $key block must run weekly"
        Assert-Condition (
            [regex]::IsMatch($body, '(?m)^\s{4}target-branch:\s*"codex/functional-platform"\s*$')
        ) "Dependabot $key block must explicitly target codex/functional-platform"
    }
    foreach ($requiredDependabot in @(
        'gomod|/',
        'npm|/apps/web',
        'npm|/contracts',
        'github-actions|/',
        'docker|/'
    )) {
        Assert-Condition (
            $actualDependabot.Contains($requiredDependabot)
        ) "Dependabot is missing required update block: $requiredDependabot"
    }
}

function Assert-Rejected {
    param(
        [scriptblock]$Operation,
        [string]$Label
    )

    $rejected = $false
    try {
        & $Operation
    }
    catch {
        $rejected = $true
    }
    Assert-Condition $rejected "self-test mutation was not rejected: $Label"
}

$paths = [ordered]@{
    Ci = '.github\workflows\ci.yml'
    Deploy = '.github\workflows\deploy.yml'
    Makefile = 'Makefile'
    Codeowners = '.github\CODEOWNERS'
    Dependabot = '.github\dependabot.yml'
    ApiDockerfile = 'Dockerfile.api'
    Dockerignore = '.dockerignore'
}
$documents = @{}
foreach ($entry in $paths.GetEnumerator()) {
    $fullPath = Join-Path $repoRoot $entry.Value
    Assert-Condition (Test-Path -LiteralPath $fullPath -PathType Leaf) "missing policy input: $($entry.Value)"
    $documents[$entry.Key] = Get-Content -LiteralPath $fullPath -Raw
}

Assert-PolicyDocuments @documents

if ($SelfTest) {
    Assert-ActionlintFixture $true @('v1.7.12', 'installed by building from source')
    Assert-Rejected { Assert-ActionlintFixture $true @('v1.7.11') } 'wrong actionlint version'
    Assert-Rejected { Assert-ActionlintFixture $false @() } 'missing actionlint binary'

    Assert-Rejected {
        Assert-PolicyDocuments -Ci ($documents.Ci.Replace(
            'branches: [main, develop, codex/functional-platform]',
            'branches: [main, develop]'
        )) -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'missing candidate branch trigger'
    Assert-Rejected {
        Assert-PolicyDocuments -Ci ($documents.Ci.Replace(
            'branches: [main, develop, codex/functional-platform]',
            'branches: [main, develop, not-codex/functional-platform-disabled]'
        )) -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'candidate branch accepted only as a substring'
    Assert-Rejected {
        Assert-PolicyDocuments -Ci ($documents.Ci.Replace(
            '-ResidueMode CleanCandidate',
            '-ResidueMode BuilderStaged'
        )) -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'weakened planning residue mode'
    Assert-Rejected {
        $disabledWebAudit = $documents.Ci.Replace(
            "      - name: Audit web dependencies and fail at moderate severity`n        run: npm audit --prefix apps/web --audit-level=moderate",
            "      - name: Audit web dependencies and fail at moderate severity`n        if: false`n        run: npm audit --prefix apps/web --audit-level=moderate"
        )
        Assert-PolicyDocuments -Ci $disabledWebAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'disabled mandatory web audit step'
    Assert-Rejected {
        $conditionalWebAudit = $documents.Ci.Replace(
            '        run: npm audit --prefix apps/web --audit-level=moderate',
            "        run: |`n          if false; then`n            npm audit --prefix apps/web --audit-level=moderate`n          fi"
        )
        Assert-PolicyDocuments -Ci $conditionalWebAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'conditionally no-op mandatory web audit command'
    Assert-Rejected {
        $echoedWebAudit = $documents.Ci.Replace(
            '        run: npm audit --prefix apps/web --audit-level=moderate',
            '        run: echo "npm audit --prefix apps/web --audit-level=moderate"'
        )
        Assert-PolicyDocuments -Ci $echoedWebAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'echoed no-op mandatory web audit command'
    Assert-Rejected {
        $continuedWebAudit = $documents.Ci.Replace(
            "      - name: Audit web dependencies and fail at moderate severity`n        run: npm audit --prefix apps/web --audit-level=moderate",
            "      - name: Audit web dependencies and fail at moderate severity`n        continue-on-error: false`n        run: npm audit --prefix apps/web --audit-level=moderate"
        )
        Assert-PolicyDocuments -Ci $continuedWebAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'continue-on-error present on mandatory web audit step'
    Assert-Rejected {
        $webAuditOutsideSecurity = $documents.Ci.Replace(
            "      - name: Audit web dependencies and fail at moderate severity`n        run: npm audit --prefix apps/web --audit-level=moderate",
            "      - name: Audit web dependencies and fail at moderate severity`n        run: echo `"web dependency audit moved out of security job`""
        ).Replace(
            '      - run: npm run build --prefix apps/web',
            "      - run: npm run build --prefix apps/web`n      - run: npm audit --prefix apps/web --audit-level=moderate"
        )
        Assert-PolicyDocuments -Ci $webAuditOutsideSecurity `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'mandatory web audit moved outside security job'
    Assert-Rejected {
        $fakeNpmBeforeAudit = $documents.Ci.Replace(
            '      - name: Audit web dependencies and fail at moderate severity',
            @'
      - name: Prepend fake npm ahead of mandatory audits
        shell: bash
        run: |
          mkdir -p "$RUNNER_TEMP/fakebin"
          printf '%s\n' '#!/bin/sh' 'exit 0' > "$RUNNER_TEMP/fakebin/npm"
          chmod +x "$RUNNER_TEMP/fakebin/npm"
          echo "$RUNNER_TEMP/fakebin" >> "$GITHUB_PATH"
      - name: Audit web dependencies and fail at moderate severity
'@.TrimEnd("`r", "`n")
        )
        Assert-PolicyDocuments -Ci $fakeNpmBeforeAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'fake npm prepended through GITHUB_PATH before mandatory audits'
    Assert-Rejected {
        $manifestMutationBeforeAudit = $documents.Ci.Replace(
            '      - name: Audit web dependencies and fail at moderate severity',
            @'
      - name: Mutate the audited manifest before mandatory audits
        shell: bash
        run: node -e "const fs=require('fs'); fs.writeFileSync('apps/web/package-lock.json','{}')"
      - name: Audit web dependencies and fail at moderate severity
'@.TrimEnd("`r", "`n")
        )
        Assert-PolicyDocuments -Ci $manifestMutationBeforeAudit `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'manifest mutation inserted before mandatory audits'
    Assert-Rejected {
        $secondCheckout = $documents.Ci.Replace(
            '      - name: Audit web dependencies and fail at moderate severity',
            @'
      - name: Replace the candidate with main before mandatory audits
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: main
          clean: true
      - name: Audit web dependencies and fail at moderate severity
'@.TrimEnd("`r", "`n")
        )
        Assert-PolicyDocuments -Ci $secondCheckout `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'second checkout replaces candidate with main'
    Assert-Rejected {
        $checkoutRefOverride = $documents.Ci.Replace(
            '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4',
            "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4`n        with:`n          ref: main"
        )
        Assert-PolicyDocuments -Ci $checkoutRefOverride `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'checkout ref override on mandatory steps'
    Assert-Rejected {
        $extraSecurityStep = $documents.Ci.Replace(
            '      - name: Audit web dependencies and fail at moderate severity',
            "      - name: Unapproved executable step`n        run: echo unapproved`n      - name: Audit web dependencies and fail at moderate severity"
        )
        Assert-PolicyDocuments -Ci $extraSecurityStep `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'extra executable step in mandatory job'
    Assert-Rejected {
        $extraJob = $documents.Ci.Replace(
            'jobs:',
            "jobs:`n  unapproved:`n    name: Unapproved admission job`n    runs-on: ubuntu-latest`n    steps:`n      - run: echo unapproved"
        )
        Assert-PolicyDocuments -Ci $extraJob `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'extra workflow job'
    Assert-Rejected {
        $workflowPathOverride = $documents.Ci.Replace(
            '  NODE_VERSION: "22.23.1"',
            "  NODE_VERSION: `"22.23.1`"`n  PATH: /tmp/fakebin"
        )
        Assert-PolicyDocuments -Ci $workflowPathOverride `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'unapproved workflow PATH override'
    Assert-Rejected {
        Assert-PolicyDocuments -Ci ($documents.Ci.Replace(
            'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
            'actions/checkout@v4'
        )) -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'unpinned external action'
    Assert-Rejected {
        $jobLevelReusable = $documents.Ci.Replace(
            'jobs:',
            "jobs:`n  reusable:`n    uses: example/reusable/.github/workflows/build.yml@main"
        )
        Assert-PolicyDocuments -Ci $jobLevelReusable `
            -Deploy $documents.Deploy -Makefile $documents.Makefile `
            -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
            -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
    } 'unpinned job-level reusable workflow'
    foreach ($noncanonicalJob in @(
        "  reusable:`n    `"uses`": example/reusable/.github/workflows/build.yml@main",
        "  reusable:`n    `"u\u0073es`": example/reusable/.github/workflows/build.yml@main",
        "  reusable:`n    `"u\x73es`": example/reusable/.github/workflows/build.yml@main",
        "  reusable:`n    'uses': example/reusable/.github/workflows/build.yml@main",
        "  reusable:`n    uses : example/reusable/.github/workflows/build.yml@main",
        "  reusable:`n    ? uses`n    : example/reusable/.github/workflows/build.yml@main",
        '  reusable: { uses: example/reusable/.github/workflows/build.yml@main }'
    )) {
        Assert-Rejected {
            $noncanonicalUses = $documents.Ci.Replace(
                'jobs:',
                "jobs:`n$noncanonicalJob"
            )
            Assert-PolicyDocuments -Ci $noncanonicalUses `
                -Deploy $documents.Deploy -Makefile $documents.Makefile `
                -Codeowners $documents.Codeowners -Dependabot $documents.Dependabot `
                -ApiDockerfile $documents.ApiDockerfile -Dockerignore $documents.Dockerignore
        } "noncanonical or flow-style job-level uses key: $noncanonicalJob"
    }
    Assert-Rejected {
        Assert-PolicyDocuments $documents.Ci $documents.Deploy $documents.Makefile (
            $documents.Codeowners.Replace('@GulfBrick', '@SomeoneElse')
        ) $documents.Dependabot $documents.ApiDockerfile $documents.Dockerignore
    } 'wrong CODEOWNERS principal'
    Assert-Rejected {
        Assert-PolicyDocuments $documents.Ci $documents.Deploy $documents.Makefile (
            $documents.Codeowners
        ) ($documents.Dependabot.Replace(
            'target-branch: "codex/functional-platform"',
            'target-branch: "main"'
        )) $documents.ApiDockerfile $documents.Dockerignore
    } 'wrong Dependabot target branch'

    Write-Output 'CI_POLICY_SELF_TEST=PASS'
}

if ($AssertActionlintVersion) {
    Invoke-ActionlintVersionGuard
    Write-Output 'ACTIONLINT_VERSION=v1.7.12'
}

Write-Output 'CI_POLICY_VALIDATION=PASS'
Write-Output 'CI_CANDIDATE_BRANCH=codex/functional-platform'
Write-Output 'DEPLOYMENT=BLOCKED'
