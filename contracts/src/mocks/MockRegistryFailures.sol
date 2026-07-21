// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockRegistryFailures
 * @notice Test-only responder for adversarial identity-registry return data.
 * @dev Responses may be selected by exact calldata or by selector. Exact calldata wins.
 */
contract MockRegistryFailures {
    struct Response {
        bool configured;
        bool shouldRevert;
        bytes returnData;
    }

    mapping(bytes4 => Response) private selectorResponses;
    mapping(bytes32 => Response) private callResponses;

    error MissingMockResponse(bytes4 selector);

    function setSelectorResponse(bytes4 selector, bytes calldata returnData) external {
        _setResponse(selectorResponses[selector], false, returnData);
    }

    function setSelectorRevert(bytes4 selector, bytes calldata revertData) external {
        _setResponse(selectorResponses[selector], true, revertData);
    }

    function setCallResponse(bytes calldata callData, bytes calldata returnData) external {
        _setResponse(callResponses[keccak256(callData)], false, returnData);
    }

    function setCallRevert(bytes calldata callData, bytes calldata revertData) external {
        _setResponse(callResponses[keccak256(callData)], true, revertData);
    }

    function clearSelectorResponse(bytes4 selector) external {
        delete selectorResponses[selector];
    }

    function clearCallResponse(bytes calldata callData) external {
        delete callResponses[keccak256(callData)];
    }

    fallback() external {
        _respond();
    }

    function _setResponse(
        Response storage response,
        bool shouldRevert,
        bytes calldata returnData
    ) private {
        response.configured = true;
        response.shouldRevert = shouldRevert;
        response.returnData = returnData;
    }

    function _respond() private view {
        Response storage exactResponse = callResponses[keccak256(msg.data)];
        if (exactResponse.configured) _finish(exactResponse);

        Response storage selectorResponse = selectorResponses[msg.sig];
        if (selectorResponse.configured) _finish(selectorResponse);

        revert MissingMockResponse(msg.sig);
    }

    function _finish(Response storage response) private view {
        bool shouldRevert = response.shouldRevert;
        bytes memory output = response.returnData;
        assembly ("memory-safe") {
            let outputStart := add(output, 0x20)
            let outputLength := mload(output)
            if shouldRevert {
                revert(outputStart, outputLength)
            }
            return(outputStart, outputLength)
        }
    }
}
