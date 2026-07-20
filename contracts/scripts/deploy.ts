import hre from 'hardhat'

async function main() {
  const { ethers } = await hre.network.create()
  const [deployer] = await ethers.getSigners()

  const AssetRegistry = await ethers.getContractFactory('AssetRegistry')
  const registry = await AssetRegistry.deploy(deployer.address)
  await registry.waitForDeployment()

  const TokenFactory = await ethers.getContractFactory('TokenFactory')
  const factory = await TokenFactory.deploy(deployer.address, await registry.getAddress())
  await factory.waitForDeployment()
  await registry.grantRole(await registry.REGISTRAR_ROLE(), await factory.getAddress())

  const P2PTradeEscrow = await ethers.getContractFactory('P2PTradeEscrow')
  const escrow = await P2PTradeEscrow.deploy(deployer.address, deployer.address, 50)
  await escrow.waitForDeployment()

  console.log('AssetRegistry:', await registry.getAddress())
  console.log('TokenFactory:', await factory.getAddress())
  console.log('P2PTradeEscrow:', await escrow.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
