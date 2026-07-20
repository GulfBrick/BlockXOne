import { expect } from 'chai'
import hre from 'hardhat'

const { ethers } = await hre.network.create()

describe('P2PTradeEscrow', () => {
  it('executes escrow trade with ERC20 payment', async () => {
    const [admin, seller, buyer] = await ethers.getSigners()

    const MockERC20 = await ethers.getContractFactory('MockERC20')
    const sellToken = await MockERC20.deploy('AssetToken', 'ASSET')
    const payToken = await MockERC20.deploy('USD Stable', 'USDS')
    await sellToken.waitForDeployment()
    await payToken.waitForDeployment()

    await sellToken.mint(seller.address, ethers.parseEther('100'))
    await payToken.mint(buyer.address, ethers.parseEther('1000'))

    const Escrow = await ethers.getContractFactory('P2PTradeEscrow')
    const escrow = await Escrow.deploy(admin.address, admin.address, 50)
    await escrow.waitForDeployment()

    await sellToken.connect(seller).approve(await escrow.getAddress(), ethers.parseEther('10'))
    await payToken.connect(buyer).approve(await escrow.getAddress(), ethers.parseEther('500'))

    const createTx = await escrow.connect(seller).createTrade(
      await sellToken.getAddress(),
      ethers.parseEther('10'),
      await payToken.getAddress(),
      ethers.parseEther('500'),
      0
    )
    await createTx.wait()

    await expect(escrow.connect(buyer).acceptTrade(1)).to.not.revert(ethers)

    const buyerAssetBal = await sellToken.balanceOf(buyer.address)
    const sellerPayBal = await payToken.balanceOf(seller.address)

    expect(buyerAssetBal).to.equal(ethers.parseEther('10'))
    expect(sellerPayBal).to.equal(ethers.parseEther('500') * 9950n / 10000n)
  })
})
