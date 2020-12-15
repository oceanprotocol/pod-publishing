#!/usr/bin/env node

const program = require('commander')
const AWS = require('aws-sdk')
const mime = require('mime-types')
const fs = require('fs')
const pg = require('pg')
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
    }
    if (outputfiles[i].column === null && outputfiles[i].url != null) {
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
  //console.log('Everything is OK')
  }
} // end main

async function getdir(folder) {
  var retfiles = []
  try{
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
  }
  catch(e){
    
  }
  return retfiles
}

async function uploadthisfile(filearr, workflowid) {
  let url
  if(filearr.uploadadminzone){
    if(process.env.IPFS_ADMINLOGS){
      url = await uploadtoIPFS(filearr, workflowid, process.env.IPFS_ADMINLOGS)  
    }
    else if(process.env.AWS_BUCKET_ADMINLOGS){
      url = await uploadtos3(filearr, workflowid, process.env.AWS_BUCKET_ADMINLOGS)
    }
    else{
      console.error('No IPFS_ADMINLOGS and no AWS_BUCKET_ADMINLOGS. Upload failed')    
      url = null
    }
  }
  else{
    if(process.env.IPFS_OUTPUT){
      url = await uploadtoIPFS(filearr, workflowid, process.env.IPFS_OUTPUT)
    }
    else if(process.env.AWS_BUCKET_OUTPUT){
      url = await uploadtos3(filearr, workflowid, process.env.AWS_BUCKET_OUTPUT)
    }
    else{
      console.error('No IPFS_OUTPUT and no AWS_BUCKET_OUTPUT. Upload failed')    
      url = null
    }
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
    Body: '',
    ACL: 'public-read'
  }
  try {
    const fileStream = fs.createReadStream(filearr.path)
    uploadParams.Body = fileStream
    uploadParams.Key = workflowid + filearr.path
    console.log("uploading:")
    console.log(uploadParams)
    const putObjectPromise = await s3.upload(uploadParams).promise()
    const location = putObjectPromise.Location
    return location
  } catch (e) {
    return null
  }
}


async function uploadtoIPFS(filearr, workflowid, ipfsURL){
  console.log("Publishing to IPFS")
  console.log(filearr)
  try{
    const ipfs = ipfsClient(ipfsURL)
    let fileStream = fs.createReadStream(filearr.path)
    const filesAdded = await ipfs.add(fileStream);
    console.log(filesAdded);
    const fileHash = filesAdded.cid.string;
    return(ipfsURL+"/ipfs/"+fileHash)
  }
  catch(e){
    console.error(e)
    return null
  }
}
