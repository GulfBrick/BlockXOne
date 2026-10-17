// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * SOURCE CANDIDATE, NOT DEPLOYED OR ADMITTED.
 * Valueless six-decimal Amoy settlement units. These are not money or fund units.
 * Supply is minted once at deployment to an explicitly selected holder. There is
 * no owner, additional mint function, proxy, upgrade or privileged transfer.
 */
contract Bx1TestSettlementToken is ERC20 {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    constructor(address initialHolder, uint256 initialSupplyBaseUnits)
        ERC20("BlockXOne Test Settlement Token", "TST")
    {
        require(block.chainid == AMOY_CHAIN_ID, "Amoy only");
        require(initialHolder != address(0), "initial holder required");
        require(initialSupplyBaseUnits > 0, "positive initial supply required");
        _mint(initialHolder, initialSupplyBaseUnits);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
