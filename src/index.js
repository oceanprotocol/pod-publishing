#!/usr/bin/env node

const program = require('commander')
const web3 = require('web3')
const { Ocean, Account } = require('@oceanprotocol/squid')
const AWS = require('aws-sdk')
const Wallet = require('ethereumjs-wallet')
const PrivateKeyProvider = require("truffle-privatekey-provider");
const fs = require('fs')

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-n, --node <url>', 'Node URL')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-l, --path <path>', 'Volume path')
  .option('--aquarius-url <url>', 'Aquarius URL')
  .option('--brizo-url <url>', 'Brizo URL')
  .option('--secret-store-url <url>', 'Secret Store URL')
  .option('--brizo-address <address>', 'Brizo address')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    let {workflow, node, credentials, password, path, aquariusUrl, brizoUrl, secretStoreUrl, brizoAddress, verbose} = program
    const config = {workflow, node, credentials, password, path, aquariusUrl, brizoUrl, secretStoreUrl, brizoAddress, verbose}

    main(config)
      .then(() => {
        if (verbose) {
          console.log('Finished!')
        }
        process.exit(0)
      })
      .catch(e => console.error(e))
  })
  .parse(process.argv)

async function main({
  workflow: workflowPath,
  node: nodeUri,
  credentials,
  password,
  path,
  aquariusUrl,
  brizoUrl,
  secretStoreUrl,
  brizoAddress,
  verbose,
}) {

  const outputsDir = `${path}/outputs`

  const log = (...args) => verbose ? console.log(...args) : undefined

  // Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = web3.utils.toChecksumAddress('0x' + credentialsWallet.getAddress().toString('hex'))
  const privateKey = credentialsWallet.getPrivateKey()

  const provider = new PrivateKeyProvider(privateKey, nodeUri);

  // Config from stage output
  const {stages} = JSON.parse(fs.readFileSync(workflowPath).toString())
    .service
    .find(({type}) => type === 'Metadata')
    .attributes
    .workflow

  const {metadataUrl, secretStoreUrl: ssUrl, accessProxyUrl, brizoAddress: bAddress, metadata} = stages.pop().output

  if (verbose) {
    console.log('Config:')
    console.log({
      nodeUri,
      aquariusUri: aquariusUrl || metadataUrl,
      brizoUri: brizoUrl || accessProxyUrl,
      secretStoreUri: secretStoreUrl || ssUrl,
      brizoAddress: brizoAddress || bAddress,
    })
  }

  const ocean = await Ocean.getInstance({
    nodeUri,
    aquariusUri: aquariusUrl || metadataUrl,
    secretStoreUri: secretStoreUrl || ssUrl,
    brizoUri: brizoUrl || accessProxyUrl,
    brizoAddress: brizoAddress || bAddress,
    parityUri: nodeUri,
    threshold: 0,
    verbose,
    web3Provider: provider,
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

  log('Files:', files)

  // Upload files to S3
  AWS.config.update({region: 'eu-central-1'})

  const s3 = new AWS.S3({apiVersion: '2006-03-01'})

  const bucketName = `pod-publishing-test-${Math.floor(Math.random() * 10 ** 8)}`
  const newBucket = {
    Bucket: bucketName,
    ACL: 'public-read',
  }

  // Bucket creation
  const bucket = (await new Promise((resolve, reject) => {
    s3.createBucket(newBucket, (err, data) => err ? reject(err) : resolve(data.Location))
  }))

  log('Bucket:', bucket)

  // Uploading files
  const uploads = files
    .map(file => new Promise((resolve, reject) => {
      const uploadParams = {
        Bucket: bucketName,
        Key: '',
        Body: '',
        ACL: 'public-read',
      }
      const filePath = outputsDir + '/' + file

      const fileStream = fs.createReadStream(filePath)
      fileStream.on('error', err => reject(err))

      uploadParams.Body = fileStream
      uploadParams.Key = file

      s3.upload(uploadParams, (err, data) => err ? reject(err) : resolve(data.Location))
    }))
  
  let uploadedFiles = await Promise.all(uploads)

  uploadedFiles = uploadedFiles.map((url, index) => ({url, index}))

  log('DDO files:', uploadedFiles)

  // Create asset
  const publishingDate = new Date().toISOString().replace(/\.[0-9]{3}Z/, 'Z')

  const ddo = await ocean.assets.create({
    base: {
      // Default metadata
      dateCreated: publishingDate,
      datePublished: publishingDate,
      author: 'pod-publishing',
      license: 'No License Specified',
      price: '0',
      // Data from DDO
      ...metadata,
      files: uploadedFiles,
    }
  }, publisher)

  log('DDO:', ddo)

  if (verbose) {
    log('Is provider:', await ocean.keeper.didRegistry.isDIDProvider(
        ddo.id,
        brizoAddress || bAddress,
    ))
    log('Attributes:', await ocean.keeper.didRegistry.getAttributesByDid(
        ddo.id,
    ))
  }

  console.log(ddo.id)
}
