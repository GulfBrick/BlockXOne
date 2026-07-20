// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title P2PTradeEscrow
/// @notice Custodies seller assets until a buyer pays with an ERC-20 settlement token.
contract P2PTradeEscrow is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    enum TradeStatus {
        Open,
        Accepted,
        Cancelled
    }

    struct Trade {
        address seller;
        address sellToken;
        uint256 sellAmount;
        address payToken;
        uint256 payAmount;
        uint256 expiresAt;
        TradeStatus status;
    }

    uint256 public nextTradeId = 1;
    address public feeRecipient;
    uint256 public feeBps;

    mapping(uint256 => Trade) public trades;

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed seller,
        address indexed sellToken,
        uint256 sellAmount,
        address payToken,
        uint256 payAmount,
        uint256 expiresAt
    );
    event TradeAccepted(uint256 indexed tradeId, address indexed buyer, uint256 feeAmount);
    event TradeCancelled(uint256 indexed tradeId);

    error AccessDenied();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidFee();
    error TradeNotOpen();
    error TradeExpired();

    constructor(address admin, address feeRecipient_, uint256 feeBps_) {
        if (admin == address(0) || feeRecipient_ == address(0)) revert InvalidAddress();
        if (feeBps_ > 10_000) revert InvalidFee();

        feeRecipient = feeRecipient_;
        feeBps = feeBps_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    function createTrade(
        address sellToken,
        uint256 sellAmount,
        address payToken,
        uint256 payAmount,
        uint256 expiresAt
    ) external returns (uint256 tradeId) {
        if (sellToken == address(0) || payToken == address(0)) revert InvalidAddress();
        if (sellAmount == 0 || payAmount == 0) revert InvalidAmount();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert TradeExpired();

        tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            seller: msg.sender,
            sellToken: sellToken,
            sellAmount: sellAmount,
            payToken: payToken,
            payAmount: payAmount,
            expiresAt: expiresAt,
            status: TradeStatus.Open
        });

        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), sellAmount);

        emit TradeCreated(tradeId, msg.sender, sellToken, sellAmount, payToken, payAmount, expiresAt);
    }

    function acceptTrade(uint256 tradeId) external {
        Trade storage trade = trades[tradeId];
        if (trade.status != TradeStatus.Open) revert TradeNotOpen();
        if (trade.expiresAt != 0 && trade.expiresAt < block.timestamp) revert TradeExpired();

        trade.status = TradeStatus.Accepted;

        uint256 feeAmount = (trade.payAmount * feeBps) / 10_000;
        uint256 sellerAmount = trade.payAmount - feeAmount;

        IERC20(trade.payToken).safeTransferFrom(msg.sender, trade.seller, sellerAmount);
        if (feeAmount > 0) {
            IERC20(trade.payToken).safeTransferFrom(msg.sender, feeRecipient, feeAmount);
        }
        IERC20(trade.sellToken).safeTransfer(msg.sender, trade.sellAmount);

        emit TradeAccepted(tradeId, msg.sender, feeAmount);
    }

    function cancelTrade(uint256 tradeId) external {
        Trade storage trade = trades[tradeId];
        if (trade.status != TradeStatus.Open) revert TradeNotOpen();
        if (msg.sender != trade.seller && !hasRole(ADMIN_ROLE, msg.sender)) revert AccessDenied();

        trade.status = TradeStatus.Cancelled;
        IERC20(trade.sellToken).safeTransfer(trade.seller, trade.sellAmount);

        emit TradeCancelled(tradeId);
    }
}
