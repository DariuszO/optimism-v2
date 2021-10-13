const { ethers } = require('ethers')
var path = require('path')
var dirtree = require('directory-tree')
var fs = require('fs')

require('dotenv')

const sleep = (timeout) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, timeout)
  })
}

async function  getTimestamp(){
  const blockNumber = await web3.eth.getBlockNumber();
  const block = await web3.eth.getBlock(blockNumber);
  const timestamp = await block.timestamp;
  return timestamp;
}

module.exports = async function (deployer) {

  const accounts = await web3.eth.getAccounts()
  const Comp = artifacts.require('Comp')
  const Timelock = artifacts.require('Timelock')
  const GovernorBravoDelegate = artifacts.require('GovernorBravoDelegate')
  const GovernorBravoDelegator = artifacts.require('GovernorBravoDelegator')

  const admin = accounts[0]

  console.log('STARTING HERE')
  console.log(admin)

  //bobaAddress = '0x84eA74d481Ee0A5332c457a4d796187F6Ba67fEB'
  // Deploy Comp
  await deployer.deploy(Comp, admin)
  const comp = await Comp.deployed()
  console.log('deployed comp')
  const compAddress = comp.address

  // Deploy Timelock
  //delay = how long the Timelock contract needs to wait before executing a transaction
  // set to 0 for local and rinkeby
  let delay_before_execute_s = 0; //seconds - normally set to 172800 aka 2 days, for example
  if (process.env.network === 'mainnet') {
    delay_before_execute_s = 172800
  }
  await deployer.deploy(Timelock, admin, delay_before_execute_s)
  const timelock = await Timelock.deployed()
  console.log('deployed timelock')

  // Deploy GovernorBravoDelegate
  await deployer.deploy(GovernorBravoDelegate)
  const governorBravoDelegate = await GovernorBravoDelegate.deployed()
  console.log('deployed delegate')

  // Deploy GovernorBravoDelegator
  await deployer.deploy(
    GovernorBravoDelegator,
    timelock.address,
    compAddress,
    timelock.address,
    governorBravoDelegate.address,
    10, // VOTING PERIOD - duration of the voting period in seconds
    1,  // VOTING DELAY - time between when a proposal is proposed and when the voting period starts, in seconds
    ethers.utils.parseEther('100000') // the votes necessary to propose
  )
  const governorBravoDelegator = await GovernorBravoDelegator.deployed()

  console.log('deployed delegator')

  console.log('\nSaving Contract Addresses')

  let contracts = {
    DAO_GovernorBravoDelegate: governorBravoDelegate.address,
    DAO_GovernorBravoDelegator: governorBravoDelegator.address,
    DAO_Comp: compAddress,
    DAO_Timelock: timelock.address,
  }

  const addresses = JSON.stringify(contracts, null, 2)
  console.log(addresses)

  const dumpsPath = path.resolve(__dirname, "../networks")

  if (!fs.existsSync(dumpsPath)) {
    fs.mkdirSync(dumpsPath, { recursive: true })
  }
  const addrsPath = path.resolve(dumpsPath, 'addresses.json')
  fs.writeFileSync(addrsPath, addresses)

  console.log('Queue setPendingAdmin')

  // set eta to be the current timestamp for local and rinkeby
  let eta = (await getTimestamp()) + 0
  if (process.env.network === 'mainnet') {
    eta = (await getTimestamp()) + 182800
  }
  const setPendingAdminData = ethers.utils.defaultAbiCoder.encode( // the parameters for the setPendingAdmin function
    ['address'],
    [governorBravoDelegator.address]
  )

  const governorBravo = await GovernorBravoDelegate.at(
    governorBravoDelegator.address
  )

  await timelock.queueTransaction(
    timelock.address,
    0, //is the amount of ETH you want to send with an execution to the Timelock
    'setPendingAdmin(address)', // the function to be called
    setPendingAdminData,
    eta // end of voting in unix time
  )

  console.log(`Time transaction was made: ${await getTimestamp()}`)
  console.log(`Time at which transaction may be executed: ${eta}`)
  console.log(`Please be patient and wait for 30 seconds...`)

  await sleep(10 * 1000)

  for(let i = 0; i < 30; i++){

    console.log(`Attempt: ${i + 1}`)
    console.log(`\tTimestamp: ${await getTimestamp()}`);

    try{
      // Execute the transaction that will set the admin of Timelock to the GovernorBravoDelegator contract
      await timelock.executeTransaction(
        timelock.address,
        0,
        'setPendingAdmin(address)', // the function to be called
        setPendingAdminData,
        eta
      );
      console.log('\texecuted setPendingAdmin')
      break;
    } catch(error) {
      console.log(error)
      if(i === 29){
        console.log("\tFailed. Please try again.\n");
        return;
      }
      // console.log(error);
      console.log("\tTransaction hasn't surpassed time lock\n");
    }
    await sleep(3 * 1000)
  }

  // set eta to be the current timestamp for local and rinkeby
  eta = (await getTimestamp()) + 0;
  if (process.env.network === 'mainnet') {
    eta = (await getTimestamp()) + 182800
  }

  var initiateData = ethers.utils.defaultAbiCoder.encode( // parameters to initate the GovernorBravoDelegate contract
    ['bytes'],
    [[]]
  )

  console.log(`Current time: ${await getTimestamp()}`);
  console.log(`Time at which transaction can be executed: ${eta}`);

  await timelock.queueTransaction(
    governorBravo.address,
    0,
    '_initiate()',
    initiateData,
    eta
  )

  console.log('queued initiate')
  console.log('execute initiate')

  await sleep(20 * 1000)

  for(let i = 0; i < 30; i++ ) {

    console.log(`Timestamp: ${await getTimestamp()}`);

    try{
        await timelock.executeTransaction(
            governorBravo.address,
            0,
            '_initiate()',
            initiateData,
            eta
        )
        console.log('Executed initiate, acceptAdmin() completed');
        break;
    }catch(error){
      if(i === 29){
        console.log("\tFailed. Please try again.\n");
        return;
      }
        // console.log(error)
        console.log("\tTransaction hasn't surpassed time lock\n");
    }
    await sleep(3 * 1000);
  }
}
