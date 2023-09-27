[![banner](https://raw.githubusercontent.com/oceanprotocol/art/master/github/repo-banner%402x.png)](https://oceanprotocol.com)

# Pod Publishing

Pod Publishing is a command-line utility that is used to publish the data generated by the Computing Pod. It can upload workflow outputs to AWS S3 bucket or IPFS, logs all processing steps, and updates a PostgreSQL database accordingly.

## Features

- Enables data processing with various workflows.
- Allows specification of workflow configuration path and credentials.
- Stores all processed data and logs in specified directories.
- Updates a PostgreSQL database with relevant information of the processed workflows.
- Can upload files to an AWS S3 bucket or IPFS, with preference for IPFS if both are available.
- Verbosity control for console output.

## Installation

Use the following command to install Pod Publishing:

```bash
npm install
```

## Usage

Pod Publishing is used through the command-line. Use the `start` script to begin processing with your desired options:

```bash
npm start -- [options]
```

Or you can run the script directly with Node:

```bash
node src/index.js [options]
```

The available options are:

- `-w, --workflow <path>`: The workflow configuration path.
- `-c, --credentials <json>`: The credentials file.
- `-p, --password <password>`: The credentials password.
- `-l, --path <path>`: The volume path.
- `--workflowid <workflowid>`: The workflow ID.
- `-v, --verbose`: Enables verbose mode.

## Example

```bash
node src/index.js -w ./samples/workflow.json -c ./creds.json -p mypassword -l ./volumePath --workflowid 12345 -v
```

## Scripts

- `start`: Starts the application.
- `lint`: Runs the linter (ESLint) on the `.js` files.
- `release`: Automates versioning and package publishing with `release-it`.

## Repository

The package's repository can be found on GitHub:

[Pod Publishing on GitHub](https://github.com/oceanprotocol/pod-publishing)

## Reporting Bugs

For bug reports, please open an issue on the GitHub repository:

[Bug Tracker](https://github.com/oceanprotocol/pod-publishing/issues)

## License

Pod Publishing is released under the Apache-2.0 License.

## Contact

For any inquiries, you can contact the developers at:

devops@oceanprotocol.com
