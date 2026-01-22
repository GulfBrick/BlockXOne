package kyc

import "encoding/json"

// BasicWorkflowV3 is a static KYC workflow template (document + liveness + AML) for high-risk jurisdictions.
// Source: "Basic eKYC (Document, Liveness, and AML) v3" provided by user.
var BasicWorkflowV3 json.RawMessage = []byte(`{
  "workflowTemplateDescription": "A basic KYC flow that uses our document verification, biometric authentication with liveness detection, and comprehensive AML, sanctions, and PEP screening. It also incorporates a compliance policy.",
  "useCaseType": "standard",
  "additionalVerificationRules": [
    {
      "type": "otp_verification",
      "mode": "none"
    }
  ],
  "compliancePolicies": [
    {
      "id": "policy_fatf_high_risk",
      "version": 1,
      "title": "FATF - Enhanced Due Diligence (High Risk)",
      "isCustom": false,
      "imgSrc": "https://assets.ccverify.xyz/workflows/policies/fatf.png"
    }
  ],
  "description": "This is the third version of the workflow",
  "tasks": [
    {
      "taskId": "start",
      "type": "ui",
      "subType": "welcome_screen",
      "isExplicit": false,
      "defaultNextTask": "consent"
    },
    {
      "taskId": "consent",
      "type": "ui",
      "subType": "consent_screen",
      "isExplicit": false,
      "defaultNextTask": "task_4_sqr_r43"
    },
    {
      "taskId": "task_4_sqr_r43",
      "type": "ui",
      "subType": "document_capture_screen",
      "implicitlyAddedForTasks": [
        "task_4_sqr",
        "task_3_9fe"
      ],
      "options": {
        "showGuidance": true,
        "enableMLAssistance": true,
        "retryAttempts": 3,
        "liveCaptureOnly": false,
        "crossDeviceOnly": false,
        "nfcCapture": false,
        "documentTypes": {
          "passport": {
            "enabled": true
          },
          "national_identity_card": {
            "enabled": true
          },
          "driving_license": {
            "enabled": true
          },
          "residence_permit": {
            "enabled": true
          }
        }
      },
      "isExplicit": false,
      "defaultNextTask": "task_4_sqr_d8e"
    },
    {
      "taskId": "task_4_sqr_d8e",
      "type": "ui",
      "subType": "biometric_capture_screen",
      "implicitlyAddedForTasks": [
        "task_4_sqr"
      ],
      "options": {
        "mode": "photo",
        "showGuidance": true,
        "enableMLAssistance": true,
        "retryAttempts": 3,
        "crossDeviceOnly": false
      },
      "isExplicit": false,
      "defaultNextTask": "task_4_sqr"
    },
    {
      "taskId": "task_4_sqr",
      "type": "check",
      "subType": "identity_check",
      "additionalParameters": {
        "action": "create_check"
      },
      "options": {
        "facialSimilarityThreshold": 80,
        "livenessThreshold": 50,
        "enrollFaces": true,
        "enrolledFacesThreshold": 3,
        "specimenDetection": true,
        "vpnDetection": true
      },
      "isExplicit": true,
      "defaultNextTask": "task_3_9fe"
    },
    {
      "taskId": "task_3_9fe",
      "type": "check",
      "subType": "document_check",
      "additionalParameters": {
        "action": "create_check"
      },
      "options": {
        "minimumPermittedAge": 25,
        "clientDataValidation": false,
        "securityElementsThreshold": 50,
        "livenessThreshold": 50,
        "documentModelValidity": true
      },
      "isExplicit": true,
      "defaultNextTask": "task_2_1ng"
    },
    {
      "taskId": "task_2_1ng",
      "type": "check",
      "subType": "extensive_screening_check",
      "additionalParameters": {
        "action": "create_check"
      },
      "options": {
        "enableMonitoring": false,
        "searchMode": "fuzzy",
        "matchThreshold": 85,
        "autoRejectThreshold": 90,
        "excludeInactive": false,
        "excludeDeceased": false,
        "excludeNoDob": false,
        "excludeNoGender": false,
        "excludeNoNationality": false,
        "excludeLowQualityAliases": false,
        "excludeNoIncorporationCountry": false
      },
      "isExplicit": true,
      "defaultNextTask": "complete"
    },
    {
      "taskId": "complete",
      "type": "ui",
      "subType": "complete_screen",
      "isExplicit": true,
      "isFinalTask": true,
      "defaultNextTask": "complete"
    }
  ],
  "uiNodes": [
    {
      "id": "node-start",
      "name": "Start Flow",
      "description": "Start",
      "iconSrc": "/images/wf-start.svg",
      "type": "start",
      "position": {
        "x": 207.5,
        "y": 50
      }
    },
    {
      "id": "task_4_sqr",
      "name": "Identity Check",
      "label": "Liveness & Selfie Verification",
      "type": "identity-check",
      "draggable": true,
      "maxInstances": 1,
      "iconSrc": "/images/check-icons/identity_check.svg",
      "description": "Perform biometric verification via selfie",
      "oneOfId": "biometric-check",
      "options": {
        "capture": {
          "showGuidance": true,
          "enableMLAssistance": true,
          "retryAttempts": 3,
          "crossDeviceOnly": false
        },
        "processing": {
          "facialSimilarityThreshold": 80,
          "livenessThreshold": 50,
          "enrollFaces": true,
          "enrolledFacesThreshold": 3,
          "specimenDetection": true,
          "vpnDetection": true
        }
      },
      "position": {
        "x": 207.5,
        "y": 170
      }
    },
    {
      "id": "task_3_9fe",
      "name": "Document Check",
      "label": "Government ID Authentication",
      "type": "government-id-check",
      "draggable": true,
      "maxInstances": 3,
      "iconSrc": "/images/check-icons/document_check.svg",
      "description": "Verify government-issued ID",
      "options": {
        "capture": {
          "showGuidance": false,
          "enableMLAssistance": true,
          "retryAttempts": 3,
          "liveCaptureOnly": false,
          "crossDeviceOnly": false,
          "nfcCapture": false,
          "documentTypes": {
            "passport": {
              "enabled": true
            },
            "national_identity_card": {
              "enabled": true
            },
            "driving_license": {
              "enabled": true
            },
            "residence_permit": {
              "enabled": true
            }
          }
        },
        "processing": {
          "minimumPermittedAge": 25,
          "clientDataValidation": false,
          "securityElementsThreshold": 50,
          "livenessThreshold": 50,
          "documentModelValidity": true
        }
      },
      "position": {
        "x": 207.5,
        "y": 270
      }
    },
    {
      "id": "task_2_1ng",
      "name": "Extensive AML Screening",
      "label": "Sanctions, PEP, and Adverse Media",
      "type": "extensive-aml-screening",
      "draggable": true,
      "maxInstances": 1,
      "iconSrc": "/images/check-icons/extensive_screening_check.svg",
      "description": "Sanctions, PEPs, and adverse media check",
      "oneOfId": "aml-screening-check",
      "options": {
        "editorUi": {
          "screeningScopes": [
            "watchlistSanctionsLists",
            "watchlistOtherOfficialLists",
            "watchlistWarCrimes",
            "watchlistTerror",
            "watchlistOtherExclusionLists",
            "watchlistSanctionsControlAndOwnership",
            "adverseMediaEnvironmentProduction",
            "pepLevel1",
            "pepLevel2",
            "pepLevel3",
            "pepLevel4",
            "adverseMediaSocialLabour",
            "adverseMediaCompetitiveFinancial",
            "adverseMediaRegulatory",
            "otherListsAssociatedEntity",
            "otherListsOrganisedCrime",
            "otherListsFinancialCrime",
            "otherListsTaxCrime",
            "otherListsCorruption",
            "otherListsTrafficking"
          ]
        },
        "processing": {
          "enableMonitoring": false,
          "searchMode": "fuzzy",
          "matchThreshold": 85,
          "autoRejectThreshold": 90,
          "excludeInactive": false,
          "excludeDeceased": false,
          "excludeNoDob": false,
          "excludeNoGender": false,
          "excludeNoNationality": false,
          "excludeLowQualityAliases": false,
          "excludeNoIncorporationCountry": false
        }
      },
      "position": {
        "x": 207.5,
        "y": 370
      }
    },
    {
      "id": "node-complete",
      "name": "Complete Flow",
      "description": "Finish KYC Journey",
      "iconSrc": "/images/wf-complete.svg",
      "type": "complete",
      "position": {
        "x": 207.5,
        "y": 470
      }
    }
  ],
  "accessRestrictionListIds": [
    "6970f6f2a2fe10000225c3ce"
  ]
}`)
