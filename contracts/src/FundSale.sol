// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FundSale - minimal fixed-price sale contract with built-in ERC20 for testnet demos
/// @notice Meant for testnet demos only. Not audited. Do not use in production as-is.
contract FundSale {
    string public name = "Demo Fund Token";
    string public symbol = "DFT";
    uint8 public immutable decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    address public treasury;
    uint256 public pricePerTokenWei; // price per whole token in wei
    uint256 public feeBps; // protocol/manager fee in basis points

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Purchased(address indexed buyer, uint256 tokenAmount, uint256 paidWei, uint256 feeWei);
    event PriceUpdated(uint256 pricePerTokenWei);
    event FeeUpdated(uint256 feeBps);
    event TreasuryUpdated(address treasury);

    error NotOwner();
    error InvalidTreasury();
    error InvalidPrice();
    error InvalidFee();
    error InsufficientPayment();

    constructor(uint256 _pricePerTokenWei, uint256 _feeBps, address _treasury) {
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_pricePerTokenWei == 0) revert InvalidPrice();
        if (_feeBps > 10_000) revert InvalidFee();
        owner = msg.sender;
        treasury = _treasury;
        pricePerTokenWei = _pricePerTokenWei;
        feeBps = _feeBps;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setPrice(uint256 _pricePerTokenWei) external onlyOwner {
        if (_pricePerTokenWei == 0) revert InvalidPrice();
        pricePerTokenWei = _pricePerTokenWei;
        emit PriceUpdated(_pricePerTokenWei);
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        if (_feeBps > 10_000) revert InvalidFee();
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function purchase(uint256 tokenAmount) external payable {
        if (tokenAmount == 0) revert InvalidPrice();
        uint256 requiredWei = tokenAmount * pricePerTokenWei;
        if (msg.value < requiredWei) revert InsufficientPayment();

        // fee
        uint256 feeWei = (msg.value * feeBps) / 10_000;
        uint256 toTreasury = msg.value - feeWei;

        // mint tokens
        _mint(msg.sender, tokenAmount);

        // forward funds
        (bool ok1, ) = treasury.call{value: toTreasury}('');
        require(ok1, "treasury transfer failed");
        if (feeWei > 0) {
            (bool ok2, ) = owner.call{value: feeWei}('');
            require(ok2, "fee transfer failed");
        }

        emit Purchased(msg.sender, tokenAmount, msg.value, feeWei);

        // refund excess (rare if user overpays)
        if (msg.value > requiredWei) {
            uint256 refund = msg.value - requiredWei;
            (bool ok3, ) = msg.sender.call{value: refund}('');
            require(ok3, "refund failed");
        }
    }

    // --- ERC20 basics (minimal) ---
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "to zero");
        uint256 bal = balanceOf[from];
        require(bal >= amount, "balance");
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "mint to zero");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
