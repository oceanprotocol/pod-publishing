#!/usr/bin/env node

const program = require('commander')
const { Ocean, Account } = require('@oceanprotocol/squid')
const Wallet = require('ethereumjs-wallet')
const fs = require('fs')

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-n, --node <url>', 'Node URL')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-o, --outputs <path>', 'Input path')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    let {workflow, node, credentials, password, outputs, verbose} = program
    workflow = JSON.parse(workflow)
    const config = {workflow, node, credentials, password, outputs, verbose}

    main(config)
      .then(() => console.log('Finished!'))
      .catch(e => console.error(e))
  })
  .parse(process.argv)

async function main({
  workflow: workflowPath,
  node: nodeUri,
  credentials,
  password,
  outputs: outputsDir,
  verbose,
}) {

  // Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = '0x' + credentialsWallet.getAddress().toString('hex')

  // Config from stage output
  const {stages} = JSON.parse(fs.readFileSync(workflowPath).toString())
    .service
    .find(({type}) => type === 'Metadata')
    .metadata
    .workflow

  const {metadataUrl, secretStoreUrl, accessProxyUrl, metadata} = stages.pop().output

  const ocean = await Ocean.getInstance({
    nodeUri,
    aquariusUri: metadataUrl,
    brizoUri: accessProxyUrl,
    secretStoreUri: secretStoreUrl,
    parityUri: nodeUri,
    threshold: 0,
    verbose,
  })

  const publisher = new Account(publicKey, ocean.instanceConfig)
  publisher.setPassword(password)

  // Read files
  const files = (await new Promise(resolve => {
    fs.readdir(outputsDir, {withFileTypes: true}, (e, fileList) => {
      resolve(fileList)
    })
  }))
    .filter(_ => _.isFile())
    .map(({name}) => name)

  console.log(files)

  // Create asset
  // await ocean.assets.create({base: {...metadata, files}}, publisher)

}
