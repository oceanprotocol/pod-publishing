#!/usr/bin/env node

const program = require('commander')
const web3 = require('web3')
const { Ocean, Account } = require('@oceanprotocol/squid')
const AWS = require('aws-sdk')
const Wallet = require('ethereumjs-wallet')
const PrivateKeyProvider = require('truffle-privatekey-provider')
const mime = require('mime-types')
const fs = require('fs')
const pg = require('pg')

var pgpool = new pg.Pool({
  user: process.env.POSTGRES_USER,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  max: 10, // max number of clients in the pool
  idleTimeoutMillis: 30000 // how long a client is allowed to remain idle before being closed
})

program
  .option('-w, --workflow <path>', 'Workflow configuraton path')
  .option('-c, --credentials <json>', 'Creadentials file')
  .option('-p, --password <password>', 'Creadentials password')
  .option('-l, --path <path>', 'Volume path')
  .option('--workflowid <workflowid>', 'Workflow id')
  .option('-v, --verbose', 'Enables verbose mode')
  .action(() => {
    const { workflow, credentials, password, path, workflowid, verbose } = program
    const config = { workflow, credentials, password, path, workflowid, verbose }

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
  credentials,
  password,
  path,
  workflowid,
  verbose
}) {
  const outputsDir = `${path}/outputs`
  const logsDir = `${path}/logs`
  const adminlogsDir = `${path}/adminlogs`

  const log = (...args) => (verbose ? console.log(...args) : undefined)
  const { stages } = JSON.parse(fs.readFileSync(workflowPath).toString())
  AWS.config.update({ region: process.env.AWS_REGION })
  log('Stages:', stages)

  /*
    Get all the files from adminlogs,logs,output and put them into an array */
  var alloutputs = []

  const outputfiles = await getdir(outputsDir)
  const adminlogs = await getdir(adminlogsDir)
  const logs = await getdir(logsDir)

  logs.forEach(element => {
    outputfiles.push(element)
  })
  adminlogs.forEach(element => {
    outputfiles.push(element)
  })
  log('OutputFiles:', outputfiles)

  // Do processing on the array and add options to each file
  var alloutputsindex = 0
  for (var i = 0; i < outputfiles.length; i++) {
    switch (outputfiles[i].path) {
      case '/data/adminlogs/configure.log':
        outputfiles[i].column = 'configlogURL'
        outputfiles[i].shouldpublish = false
        outputfiles[i].uploadadminzone = true
        break
      case '/data/adminlogs/filter.log':
        outputfiles[i].column = null
        outputfiles[i].shouldpublish = false
        outputfiles[i].uploadadminzone = true
        break
      case '/data/adminlogs/publish.log':
        outputfiles[i].column = 'publishlogURL'
        outputfiles[i].shouldpublish = false
        outputfiles[i].uploadadminzone = true
        break
      case '/data/logs/algorithm.log':
        outputfiles[i].column = 'algologURL'
        if (
          stages[0].output.publishAlgorithmLog === true ||
          stages[0].output.publishAlgorithmLog === 1 ||
          stages[0].output.publishAlgorithmLog === '1'
        ) {
          outputfiles[i].shouldpublish = true
        } else {
          outputfiles[i].shouldpublish = false
          outputfiles[i].uploadadminzone = false
        }
        break
      default:
        outputfiles[i].column = null
        outputfiles[i].isoutput = true
        if (
          stages[0].output.publishOutput === true ||
          stages[0].output.publishOutput === 1 ||
          stages[0].output.publishOutput === '1'
        ) {
          outputfiles[i].shouldpublish = true
        } else {
          outputfiles[i].shouldpublish = false
          outputfiles[i].uploadadminzone = false
        }
        break
    }
    // log("Calling publish with",outputfiles[i])
    const uploadUrl = await uploadthisfile(outputfiles[i], workflowid)
    /* eslint-disable-next-line */
    outputfiles[i].url = uploadUrl
    if (outputfiles[i].shouldpublish === true && outputfiles[i].url != null) {
      /* eslint-disable-next-line */
      outputfiles[i].index = alloutputsindex
      alloutputsindex++
      alloutputs.push(outputfiles[i].url)
    }
    if (outputfiles[i].column != null) {
      await updatecolumn(outputfiles[i].column, outputfiles[i].url, workflowid)
    }
  }

  log('alloutputs:', alloutputs)
  await updatecolumn('outputsURL', JSON.stringify(alloutputs), workflowid)

  log('outputfiles:', outputfiles)

  console.log('=======================')
  const publishfiles = outputfiles
    .filter(val => {
      var x = val.shouldpublish
      console.log(x)
      return x
    })
    .map(({ url, name, contentLength, contentType, index }) => ({
      url,
      name,
      contentLength,
      contentType,
      index
    }))

  console.log('=======================')
  log('Publish files:', publishfiles)

  if (publishfiles.length > 0) {
    // publish only if we have to
    // Config
    const credentialsWallet = Wallet.fromV3(credentials, password, true)
    const publicKey = web3.utils.toChecksumAddress(
      '0x' + credentialsWallet.getAddress().toString('hex')
    )
    const privateKey = credentialsWallet.getPrivateKey()
    const provider = new PrivateKeyProvider(privateKey, stages[0].output.nodeUri)
    // Config from stage output
    if (verbose) {
      console.log('Config:')
      console.log({
        nodeUri: stages[0].output.nodeUri,
        aquariusUri: stages[0].output.metadataUri,
        brizoUri: stages[0].output.brizoUri,
        secretStoreUri: stages[0].output.secretStoreUri,
        brizoAddress: stages[0].output.brizoAddress
      })
    }
    const ocean = await Ocean.getInstance({
      nodeUri: stages[0].output.nodeUri,
      aquariusUri: stages[0].output.metadataUri,
      brizoUri: stages[0].output.brizoUri,
      secretStoreUri: stages[0].output.secretStoreUri,
      brizoAddress: stages[0].output.brizoAddress,
      parityUri: stages[0].output.nodeUri,
      threshold: 0,
      verbose,
      web3Provider: provider
    })
    if (verbose) {
      console.log(await ocean.versions.get())
      console.log('Done ocean dump')
    }
    const publisher = new Account(publicKey, ocean.instanceConfig)
    publisher.setPassword(password)

    // Create asset
    const publishingDate = new Date().toISOString().replace(/\.[0-9]{3}Z/, 'Z')
    const originalddo = {
      main: {
        // Default metadata
        dateCreated: publishingDate,
        datePublished: publishingDate,
        author: 'pod-publishing',
        name: 'job-' + workflowid + '-output',
        license: 'No License Specified',
        price: '0',
        type: 'dataset',
        files: publishfiles,
        ...stages[0].output.metadata.main
      },
      additionalAttributes: {
        // Data from DDO
        ...stages[0].output.metadata.additionalAttributes
      }
    }
    log('Create this DDO:', originalddo)
    const ddo = await ocean.assets.create(originalddo, publisher)
    log('DDO:', ddo)
    await updatecolumn('ddo', JSON.stringify(ddo), workflowid)
    // TO DO - add whitelist
    console.log('Whitelist')
    console.log(stages[0].output.whitelist)
    // TO DO - transfer onwership
    console.log('Owner')
    console.log(stages[0].output.owner)
    if (stages[0].output.owner != null) {
      try {
        const result = await ocean.assets.transferOwnership(
          ddo.id,
          stages[0].output.owner
        )
        log('Transfer owership:', result)
      } catch (e) {
        log('Tramsfer ownership failed', e)
      }
    }

    if (verbose) {
      log(
        'Is provider:',
        await ocean.keeper.didRegistry.isDIDProvider(
          ddo.id,
          stages[0].output.brizoAddress
        )
      )
      log('Attributes:', await ocean.keeper.didRegistry.getAttributesByDid(ddo.id))
    }
    console.log(ddo.id)
  } // end publish to ocean
  console.log('Everything is OK')
} // end main

async function getdir(folder) {
  var retfiles = []
  var files = await fs.readdirSync(folder, { withFileTypes: true })
  for (var i = 0; i < files.length; i++) {
    var file = files[i]
    if (file.isFile()) {
      var arr = []
      arr.name = file.name
      arr.path = folder + '/' + file.name
      arr.contentType = mime.lookup(file.name) || undefined
      arr.contentLength = String(fs.statSync(`${folder}/${file.name}`).size)
      arr.isoutput = false
      retfiles.push(arr)
    }
  }
  return retfiles
}

async function uploadthisfile(filearr, workflowid) {
  const url = await uploadtos3(filearr, workflowid)
  console.log('Got ' + url + '')
  return url
}

async function updatecolumn(column, value, workflowid) {
  if (pgpool != null) {
    try {
      var queryup = 'UPDATE jobs SET ' + column + '=$1 WHERE workflowId=$2'
      var sqlArr = []
      sqlArr[0] = value
      sqlArr[1] = workflowid
      await pgpool.query(queryup, sqlArr)
    } catch (e) {
      console.error(e)
    }
  }
}

async function uploadtos3(filearr, workflowid) {
  let bucketName
  if (filearr.uploadadminzone === true) bucketName = process.env.AWS_BUCKET_ADMINLOGS
  else bucketName = process.env.AWS_BUCKET_OUTPUT
  const s3 = new AWS.S3({ apiVersion: '2006-03-01' })
  const uploadParams = {
    Bucket: bucketName,
    Key: '',
    Body: '',
    ACL: 'public-read'
  }
  const fileStream = fs.createReadStream(filearr.path)
  // TO DO - check for null
  uploadParams.Body = fileStream
  uploadParams.Key = workflowid + filearr.path
  try {
    console.log("uploading:")
    console.log(uploadParams)
    const putObjectPromise = await s3.upload(uploadParams).promise()
    const location = putObjectPromise.Location
    return location
  } catch (e) {
    return null
  }
}
