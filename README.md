# resumable-google-drive-uploader
Node.js script(s) to allow resumable, chunked upload of files to Google Drive

### How to use

#### Initial setup
You'll only need to do this once on your machine.

- Ensure you've got a working Node 10/NPM environment on your machine
- Clone this repository and change into it
- `npm install` to download dependencies

#### Grant Google Drive access
These scripts use the [Google Drive v3 API](https://developers.google.com/drive/api/v3/manage-uploads#http_1), and need some setup to be done to allow them access to your Google Drive. Again, you'll only need to do this once:

- Follow the [Node.js Quickstart process](https://developers.google.com/drive/api/v3/quickstart/nodejs) to grant access to your Drive, and download the client configuration to `credentials.json` in this directory.

#### Get an access token for an uploading session

- Run `node authorize.js` - this will use your credentials file to obtain an access token.
- This file is a copy of the `index.js` from the Quickstart process above - just follow the on-screen instructions to grant access and paste the special code back at the prompt
- The access token is now saved in `token.json`

#### Begin the upload

- Run `node upload.js <filename> [mime-type]`
- The script will break the file into small chunks and upload them using the [Google Drive resumable upload](https://developers.google.com/drive/api/v3/manage-uploads#resumable) mechanism. 
- It keeps track of where it is uploading to using `uploadLocation.json` - if there's no such file, it assumes this is a new upload. If there's already a file, it will attempt to resume an earlier upload from where it left off
- Once the upload successfully completes, you should be able to see the file in the Google Drive web UI. The script will delete `uploadLocation.json` so it's ready to upload another file



