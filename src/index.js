#!/usr/bin/env node

const program = require('commander')
const AWS = require('aws-sdk')
const mime = require('mime-types')
const fs = require('fs')
const pg = require('pg')
const myPath = require('path')
const ipfsClient = require('ipfs-http-client')

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
    const uploadUrl = await uploadthisfile(outputfiles[i], workflowid)
    if (uploadUrl) {
      outputfiles[i].url = uploadUrl
      switch (outputfiles[i].path) {
        case '/data/adminlogs/configure.log':
          outputfiles[i].type = 'configrationLog'
          break
        case '/data/adminlogs/filter.log':
          outputfiles[i].type = 'filteringLog'
          break
        case '/data/adminlogs/publish.log':
          outputfiles[i].type = 'publishLog'
          break
        case '/data/logs/algorithm.log':
          outputfiles[i].type = 'algorithmLog'
          break
        default:
          outputfiles[i].type = 'output'
      }
      outputfiles[i].index = alloutputsindex
      alloutputsindex++

      const statsObj = fs.statSync(outputfiles[i].path)
      const filename = myPath.basename(outputfiles[i].path)
      const output = {
        filename,
        filesize: statsObj.size,
        url: outputfiles[i].url,
        type: outputfiles[i].type
      }
      alloutputs.push(output)
    }
  }

  await updatecolumn('outputsURL', JSON.stringify(alloutputs), workflowid)
  console.log('=======================')
} // end main

async function getdir(folder) {
  var retfiles = []
  try {
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
  } catch (e) {
    console.log('Dir parse failed')
  }
  return retfiles
}

async function uploadthisfile(filearr, workflowid) {
  let url
  if (process.env.IPFS_OUTPUT) {
    url = await uploadtoIPFS(
      filearr,
      workflowid,
      process.env.IPFS_OUTPUT,
      process.env.IPFS_OUTPUT_PREFIX,
      process.env.IPFS_EXPIRY_TIME,
      process.env.IPFS_API_KEY,
      process.env.IPFS_API_CLIENT
    )
  } else if (process.env.AWS_BUCKET_OUTPUT) {
    url = await uploadtos3(filearr, workflowid, process.env.AWS_BUCKET_OUTPUT)
  } else {
    console.error('No IPFS_OUTPUT and no AWS_BUCKET_OUTPUT. Upload failed')
    url = null
  }

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

async function uploadtos3(filearr, workflowid, bucketName) {
  const s3 = new AWS.S3({ apiVersion: '2006-03-01' })
  const uploadParams = {
    Bucket: bucketName,
    Key: '',
    Body: ''
  }
  try {
    const fileStream = fs.createReadStream(filearr.path)
    uploadParams.Body = fileStream
    uploadParams.Key = workflowid + filearr.path
    console.log('uploading:')
    console.log(uploadParams)
    const putObjectPromise = await s3.upload(uploadParams).promise()
    const location = putObjectPromise.Location
    return location
  } catch (e) {
    return null
  }
}

async function uploadtoIPFS(
  filearr,
  workflowid,
  ipfsURL,
  ipfsURLPrefix,
  expiry,
  ipfsApiKey,
  ipfsApiClient
) {
  console.log('Publishing to IPFS with options:')

  try {
    const headers = {}
    if (ipfsApiKey) {
      headers['X-API-KEY'] = ipfsApiKey
    }
    if (ipfsApiClient) {
      headers['CLIENT-ID'] = ipfsApiClient
    }
    const ipfs = ipfsClient({ url: ipfsURL, headers: headers })
    const fileStream = fs.createReadStream(filearr.path)
    const fileDetails = {
      path: filearr.path,
      content: fileStream
    }

    let options
    if (expiry) {
      options = Object()
      options.wrapWithDirectory = true
      /* (see https://github.com/ipfs/ipfs-cluster/blob/dbca14e83295158558234e867477ce07a523b81b/CHANGELOG.md#rest-api-2_)
      Since IPFS expects value in Go's time format, i.e. 12h, we are going to divide the expiry to 60 and round it up
      */
      options['expire-in'] = Math.ceil(parseInt(expiry) / 60)
    } else {
      options = {
        // wrap with a directory to preserve file name
        // so we end up with ipfs://HASH/file.pdf
        wrapWithDirectory: true
      }
    }
    console.log(options)
    const filesAdded = await ipfs.add(fileDetails, options)
    console.log('---------Got---------------------------')
    console.log(filesAdded)
    console.log('------------------------------------')
    const fileHash = `${filesAdded.cid.toString()}/${filearr.path}`
    if (ipfsURLPrefix) {
      if (ipfsURLPrefix.endsWith('/')) return ipfsURLPrefix + fileHash
      else return ipfsURLPrefix + '/' + fileHash
    } else return ipfsURL + '/ipfs/' + fileHash
  } catch (e) {
    console.error(e)
    return null
  }
}
