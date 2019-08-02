#!/usr/bin/env node

const program = require('commander')
const { Ocean, Account } = require('@oceanprotocol/squid')
const AWS = require('aws-sdk')
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
    const config = {workflow, node, credentials, password, outputs, verbose}

    main(config)
      .then(() => verbose && console.log('Finished!'))
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

  const log = (...args) => verbose ? console.log(...args) : undefined

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
    brizoAddress: `0x${'0'.repeat(39)}1`,
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
      const filePath = outputsDir + file

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

  console.log(ddo.id)
}
