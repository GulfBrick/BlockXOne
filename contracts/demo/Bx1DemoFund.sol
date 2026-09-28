// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Synthetic, non-transferable fund units for an Amoy-only demonstration.
/// @dev This is not an ERC-20 investment token, payment rail, or production fund contract.
contract Bx1DemoFund {
    string public constant name = "BX1 Demo Fund Units";
    string public constant symbol = "BX1DFUND";
    uint8 public constant decimals = 0;

    uint8 public constant MINT_KIND = 1;
    uint8 public constant BURN_KIND = 2;
    uint256 public constant AMOY_CHAIN_ID = 80002;

    address public immutable owner;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(bytes32 => bool) public consumedOperationIds;

    event Transfer(address indexed from, address indexed to, uint256 units);
    event OperationExecuted(bytes32 indexed operationId, uint8 kind, address indexed wallet, uint256 units);

    error AmoyOnly();
    error OwnerOnly();
    error InvalidOperationId();
    error InvalidWallet();
    error InvalidUnits();
    error OperationAlreadyConsumed();
    error InsufficientUnits();

    constructor() {
        if (block.chainid != AMOY_CHAIN_ID) revert AmoyOnly();
        owner = msg.sender;
    }

    modifier onlyOwnerOnAmoy() {
        if (block.chainid != AMOY_CHAIN_ID) revert AmoyOnly();
        if (msg.sender != owner) revert OwnerOnly();
        _;
    }

    function mintWithOperation(bytes32 operationId, address wallet, uint256 units) external onlyOwnerOnAmoy {
        _consumeOperation(operationId, wallet, units);
        totalSupply += units;
        balanceOf[wallet] += units;
        emit Transfer(address(0), wallet, units);
        emit OperationExecuted(operationId, MINT_KIND, wallet, units);
    }

    function burnWithOperation(bytes32 operationId, address wallet, uint256 units) external onlyOwnerOnAmoy {
        _consumeOperation(operationId, wallet, units);
        uint256 balance = balanceOf[wallet];
        if (balance < units) revert InsufficientUnits();
        unchecked {
            balanceOf[wallet] = balance - units;
            totalSupply -= units;
        }
        emit Transfer(wallet, address(0), units);
        emit OperationExecuted(operationId, BURN_KIND, wallet, units);
    }

    function _consumeOperation(bytes32 operationId, address wallet, uint256 units) private {
        if (operationId == bytes32(0)) revert InvalidOperationId();
        if (wallet == address(0)) revert InvalidWallet();
        if (units == 0) revert InvalidUnits();
        if (consumedOperationIds[operationId]) revert OperationAlreadyConsumed();
        consumedOperationIds[operationId] = true;
    }
}
