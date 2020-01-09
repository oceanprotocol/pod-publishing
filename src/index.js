#!/usr/bin/env node

const program = require('commander')
const web3 = require('web3')
const { Ocean, Account } = require('@oceanprotocol/squid')
const AWS = require('aws-sdk')
const Wallet = require('ethereumjs-wallet')
const PrivateKeyProvider = require("truffle-privatekey-provider");
const mime = require('mime-types')
const fs = require('fs')

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-n, --node <url>', 'Node URL')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-l, --path <path>', 'Volume path')
  .option('--aquarius <url>', 'Aquarius URL')
  .option('--brizo <url>', 'Brizo URL')
  .option('--secretstore <url>', 'Secret Store URL')
  .option('--address <address>', 'Brizo address')
  .option('--workflowid <workflowid>', 'Workflow id')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    let {workflow, node, credentials, password, path, aquariusUrl, brizoUrl, secretStoreUrl, brizoAddress,workflowid, verbose} = program
    const config = {workflow, node, credentials, password, path, aquariusUrl, brizoUrl, secretStoreUrl, brizoAddress,workflowid, verbose}

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
  cbrizoUrl:brizoUrl,
  csecretStoreUrl:secretStoreUrl,
  cbrizoAddress:brizoAddress,
  workflowid,
  verbose
}) {


  
  const outputsDir = `${path}/outputs`
  const logsDir = `${path}/logs`

  const log = (...args) => verbose ? console.log(...args) : undefined




  // Read files
  const getFiles = folder => new Promise(resolve => {
    fs.readdir(folder, {withFileTypes: true}, (e, fileList) => {
      resolve(
        (fileList || [])
          .filter(_ => _.isFile())
          .map(({name}) => ({
            name,
            path: `${folder}/${name}`,
            contentType: mime.lookup(name) || undefined,
            contentLength: String(fs.statSync(`${folder}/${name}`).size),
          }))
      )
    })
  })

const files = await getFiles(outputsDir)
log('Files:', files)
const logs = await getFiles(logsDir)
log('Logs:', logs)



  // Config
  const credentialsWallet = Wallet.fromV3(credentials, password, true)
  const publicKey = web3.utils.toChecksumAddress('0x' + credentialsWallet.getAddress().toString('hex'))
  const privateKey = credentialsWallet.getPrivateKey()

  const provider = new PrivateKeyProvider(privateKey, nodeUri);

  // Config from stage output
  const {stages} = JSON.parse(fs.readFileSync(workflowPath).toString())
  //const {metadataUrl, secretStoreUrl, brizoUrl, brizoAddress, metadata,owner} = stages.pop().output

  if (verbose) {
    console.log('Config:')
    console.log({
      nodeUri,
      aquariusUri: stages[0].output.metadataUrl,
      brizoUri: stages[0].output.brizoUrl,
      secretStoreUri: stages[0].output.secretStoreUrl,
      brizoAddress: stages[0].output.brizoAddress,
    })
  }

  const ocean = await Ocean.getInstance({
    nodeUri,
    aquariusUri: stages[0].output.metadataUrl,
    brizoUri: stages[0].output.brizoUrl,
    secretStoreUri: stages[0].output.secretStoreUrl,
    brizoAddress: stages[0].output.brizoAddress,
    parityUri: nodeUri,
    threshold: 0,
    verbose,
    web3Provider: provider,
  })
  if (verbose) {
    console.log(await ocean.versions.get())
    console.log("Done ocean dump")
  }
  const publisher = new Account(publicKey, ocean.instanceConfig)
  publisher.setPassword(password)



  // Upload files to S3
  AWS.config.update({region: 'us-east-1'})

  const s3 = new AWS.S3({apiVersion: '2006-03-01'})

  /*const bucketName = `pod-publishing-test-${Math.floor(Math.random() * 10 ** 8)}`
  const newBucket = {
    Bucket: bucketName,
    ACL: 'public-read',
  }

  // Bucket creation
  const bucket = (await new Promise((resolve, reject) => {
    s3.createBucket(newBucket, (err, data) => err ? reject(err) : resolve(data.Location))
  }))

  log('Bucket:', bucket)
  */
 const bucketName="compute-publish"
  // Uploading files
  const uploads = [...files, ...logs]
    .map(file => new Promise((resolve, reject) => {
      const uploadParams = {
        Bucket: bucketName,
        Key: '',
        Body: '',
        ACL: 'public-read',
      }
      const filePath = file.path

      const fileStream = fs.createReadStream(filePath)
      fileStream.on('error', err => reject(err))

      uploadParams.Body = fileStream
      uploadParams.Key = workflowid+file.path
      
      s3.upload(uploadParams, (err, data) => err ? reject(err) : resolve({...file, url: data.Location}))
    }))
  
  let uploadedFiles = await Promise.all(uploads)

  uploadedFiles = uploadedFiles.map(
    ({url, name, contentLength, contentType}, index) => ({url, name, contentLength, contentType, index})
  )

  log('DDO files:', uploadedFiles)

  // Create asset
  const publishingDate = new Date().toISOString().replace(/\.[0-9]{3}Z/, 'Z')

  const ddo = await ocean.assets.create({
    main: {
      // Default metadata
      dateCreated: publishingDate,
      datePublished: publishingDate,
      author: 'pod-publishing',
      name: 'output-dataset',
      license: 'No License Specified',
      price: '0',
      type: "dataset",
      files: uploadedFiles,
    },
    additionalAttributes: {
      // Data from DDO
      ...stages[0].output.metadata,
      categories: []
    }
  }, publisher)

  log('DDO:', ddo)

  if (verbose) {
    log('Is provider:', await ocean.keeper.didRegistry.isDIDProvider(
        ddo.id,
        stages[0].output.brizoAddress,
    ))
    log('Attributes:', await ocean.keeper.didRegistry.getAttributesByDid(
        ddo.id,
    ))
  }

  console.log(ddo.id)
}
