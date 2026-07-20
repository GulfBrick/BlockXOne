import { expect } from 'chai'
import hre from 'hardhat'

const { ethers } = await hre.network.create()

function parseAssetTokenDeployed(factory: any, receipt: any) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === factory.target.toLowerCase()) {
      const parsed = factory.interface.parseLog(log)
      if (parsed && parsed.name === 'AssetTokenDeployed') return parsed.args
    }
  }
  return null
}

describe('TokenFactory', () => {
  it('deploys asset token and enforces whitelist', async () => {
    const [admin, issuer, investor, outsider] = await ethers.getSigners()

    const AssetRegistry = await ethers.getContractFactory('AssetRegistry')
    const registry = await AssetRegistry.deploy(admin.address)
    await registry.waitForDeployment()

    const TokenFactory = await ethers.getContractFactory('TokenFactory')
    const factory = await TokenFactory.deploy(admin.address, await registry.getAddress())
    await factory.waitForDeployment()
    await registry
      .connect(admin)
      .grantRole(await registry.REGISTRAR_ROLE(), await factory.getAddress())

    const assetId = ethers.keccak256(ethers.toUtf8Bytes('asset-001'))

    const tx = await factory.createAssetToken(
      assetId,
      'BlockXOne Asset',
      'BXO',
      'RealEstate',
      'ipfs://example',
      issuer.address
    )
    const receipt = await tx.wait()

    const args = parseAssetTokenDeployed(factory, receipt)
    expect(args).to.not.equal(null)

    const tokenAddress = args.token
    const registryAddress = args.complianceRegistry

    const token = await ethers.getContractAt('BXOAssetToken', tokenAddress)
    const compliance = await ethers.getContractAt('BXOComplianceRegistry', registryAddress)

    await compliance.connect(admin).setWhitelisted(issuer.address, true)
    await compliance.connect(admin).setWhitelisted(investor.address, true)

    await expect(token.connect(issuer).mint(investor.address, ethers.parseEther('100')))
      .to.not.revert(ethers)

    await expect(
      token.connect(investor).transfer(outsider.address, ethers.parseEther('1'))
    ).to.revert(ethers)
  })
})
