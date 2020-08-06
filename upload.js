const fs = require('fs');
const request = require('request');
const {google} = require('googleapis');
const util = require('util');
const TOKEN_PATH = 'token.json';
const UPLOAD_LOCATION_PATH = 'uploadLocation.json';

// const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4Mb
// const CHUNK_SIZE_BYTES = 1 * 1024 * 1024; // 1Mb
const CHUNK_SIZE_BYTES = 256 * 1024; // 256Kb 

const open = util.promisify(fs.open);
const read = util.promisify(fs.read);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const pRequest = util.promisify(request);

async function authorize() {
	// Check if we have previously stored a token.
	const token = await readFile(TOKEN_PATH);
	const jsonToken = JSON.parse(token); 
	return jsonToken.access_token;
}

async function readUploadLocation() {
	try {
		const loc = await readFile(UPLOAD_LOCATION_PATH, 'utf8');
		return loc.toString(); 
	} catch (err) {
		return undefined;
	}
}


// Returns the upload URL on success
async function beginUpload(accessToken, fileName, mimeType) {
	var fileMetadata = {
	  'name': fileName 
	};
	var media = {
	  mimeType, 
	  name: fileName 
	};
	console.log(`Requesting creation of ${fileName} (MIME type: ${mimeType})`);

	const initialResponse = await pRequest({
			method: "POST",
			url:
				"https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(media),
		});

	if (initialResponse.statusCode !== 200) {
		console.log('Response body: ', JSON.stringify(initialResponse.body)); 
		const jsonBody = JSON.parse(initialResponse.body);
		console.log('Response err: ', JSON.stringify(jsonBody.error)); 
		const message = jsonBody.error.message;
		throw new Error(message);
	}
	const { location } = initialResponse.headers;
	console.log(`Upload location: '${location}'`);
	return location; 
};

async function resumeUpload(accessToken, url, fileSize) {
	console.log(`Resuming upload at ${JSON.stringify(url)}`);
	const resumeResponse = await pRequest({
			method: "PUT",
			url,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				"Content-Range": `bytes */${fileSize}`
			},
			body: '' 
		});

	if (resumeResponse.statusCode < 308) {
	 	const message = "Upload appears to have completed. Aborting";	
		throw new Error(message);
	}
	if (resumeResponse.statusCode > 308) {
	 	const message = `Upload session has expired. Upload must be restarted (delete ${UPLOAD_LOCATION_PATH}).`;	
		throw new Error(message);
	}
	const { range } = resumeResponse.headers;

	if (!range) return 0;
	const MATCHER = /bytes[\D]\d+-(\d+)/
	const maxByte = parseInt(range.match(MATCHER)[1], 10);
	const nextByte = maxByte + 1;
	console.log(`Uploaded range: '${range}' so resuming from byte ${nextByte}`);
	return nextByte; 
};

async function uploadChunk(accessToken, url, startPos, chunkSize, fileName, fileSize) {
	const endPos = startPos + chunkSize;

	const fd = await open(fileName);
	const buffer = Buffer.alloc(chunkSize);
	const readResult = await read(fd, buffer, 0, chunkSize, startPos); 
	const body = readResult.buffer;

	const uploadResponse = await pRequest({
			method: "PUT",
			url,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Length": `${chunkSize}`,
				"Content-Range": `bytes ${startPos}-${endPos-1}/${fileSize}`
			},
			body 
		});

	if (uploadResponse.statusCode < 308) {
	 	const message = "Upload appears to have completed. ";	
		console.log(message);
	 	return fileSize;	
	}
	if (uploadResponse.statusCode > 308) {
	 	console.log(`Upload session has aborted with code ${uploadResponse.statusCode}`);
		const jsonBody = JSON.parse(uploadResponse.body);
		console.log('Response err: ', JSON.stringify(jsonBody.error)); 
	 	const message = `Upload session has aborted with code ${uploadResponse.statusCode} and message ${jsonBody.error.message}, but should be resumable`; 
		throw new Error(message);
	}

	return endPos; 
};


(async () => {
	try {
		const args = process.argv.slice(2);
		if (args.length < 1) {
			console.error('Please supply <filename> [mimetype]');
			process.exit(1);
		}
		const fileName = args[0];
		const mimeType = (args.length > 1) ? args[1] : 'video/quicktime';
		const fileSize = fs.statSync(fileName).size;

		const accessToken = await authorize();

		let uploadLocation = await readUploadLocation();
		let uploadPosition = 0;
		if (!uploadLocation) {
			uploadLocation = await beginUpload(accessToken, fileName,mimeType);
      await writeFile(UPLOAD_LOCATION_PATH, uploadLocation, 'utf8');
		} else {
			// We already have a location, see if we need to start at a non-zero offset
			uploadPosition = await resumeUpload(accessToken, uploadLocation, fileSize);
		}

		const numFullSizeChunks = Math.floor(fileSize / CHUNK_SIZE_BYTES);
		const finalChunkSize = (fileSize % CHUNK_SIZE_BYTES);
		const numFinalChunks = (finalChunkSize > 0) ? 1 : 0;
		const totalNumChunks = numFullSizeChunks + numFinalChunks;

		console.log(`Will break the ${fileSize}b file into ${totalNumChunks} chunks;`);
		console.log(`${numFullSizeChunks} chunk(s) of size ${CHUNK_SIZE_BYTES}b`);
		console.log(`${numFinalChunks} final chunk(s) of size ${finalChunkSize}b`);

		console.log(`Uploading from byte ${uploadPosition}`);

		if (numFullSizeChunks > 0) {
			while (uploadPosition < (fileSize - finalChunkSize)) {
				const percentage = (uploadPosition * 100) / fileSize;
				console.log(`  Chunk: ${uploadPosition}\t(${percentage}%)`);
				uploadPosition = await uploadChunk(accessToken, uploadLocation, uploadPosition, CHUNK_SIZE_BYTES, fileName, fileSize);
			} 
		}

		if (numFinalChunks > 0) {
				const percentage = (uploadPosition * 100) / fileSize;
				console.log(`  Chunk: ${uploadPosition}\t(${percentage}%)`);
				const uploadedBytes = await uploadChunk(accessToken, uploadLocation, uploadPosition, finalChunkSize, fileName, fileSize);
				if (uploadedBytes === fileSize) {
					console.log(`${uploadedBytes}b uploaded successfully. Removing ${UPLOAD_LOCATION_PATH} file.`);
					fs.unlinkSync(UPLOAD_LOCATION_PATH);
				}
		}
 
		
	} catch (e) {
		console.error("Upload Failed. ", e);
	}
})();


