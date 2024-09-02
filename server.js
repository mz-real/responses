const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();
const { Dropbox } = require('dropbox');

const querystring = require('querystring');

const app = express();
const upload = multer({ dest: 'uploads/' });
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Define the destination folder
        const uploadPath = path.join(__dirname, 'responses');

        // Create the folder if it doesn't exist
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }

        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Extract ID from query parameters
        const id = req.query.id || 'unknown';

        // Create the filename with ID at the start
        const fileName = `${id}_${file.originalname}.${file.mimetype}`;
        cb(null, fileName);
    }
});
const resultsfiles = multer({ storage });
app.use(express.static('public')); // Serve static files

// Token cache
let cachedToken = null;
let tokenExpiration = null;

// Helper function to generate DL Number
const generateDLNumber = (firstName, lastName, dob) => {
    const surname = (lastName.length >= 5 ? lastName.substring(0, 5) : lastName.padEnd(5, '9')).toUpperCase();
    const dobYear = dob.substring(2, 4);
    const dobMonth = dob.substring(5, 7);
    const dobDay = dob.substring(8, 10);
    const initials = `${firstName[0]}${firstName[1] || '9'}`.toUpperCase();
    const randomDigits = Math.floor(Math.random() * 900 + 100).toString();

    return `${surname}${dobYear}${dobMonth}${dobDay}${initials}${randomDigits}`;
};

// Helper function to generate a Random Date of Birth
const generateRandomDOB = () => {
    const start = new Date(1980, 0, 1);
    const end = new Date(1994, 11, 31);
    const dob = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return dob.toISOString().split('T')[0]; // Format as YYYY-MM-DD
};

// Helper function to pick a Random Image from the passport_photo folder
const pickRandomImage = () => {
    const imagesDir = path.join(__dirname, 'passport_photo');
    const images = fs.readdirSync(imagesDir);
    const randomImage = images[Math.floor(Math.random() * images.length)];
    return path.join(imagesDir, randomImage,);
};

// Get Access Token for Photoshop API
const getAccessToken = async () => {
    if (cachedToken && tokenExpiration > Date.now()) {
        return cachedToken;
    }

    try {
        const response = await axios.post(
            'https://ims-na1.adobelogin.com/ims/token/v1',
            querystring.stringify({
                grant_type: 'client_credentials',
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                scope: 'openid,AdobeID,read_organizations',
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        cachedToken = response.data.access_token;
        // Set token expiration to 55 minutes (API tokens typically last for 60 minutes)
        tokenExpiration = Date.now() + (55 * 60 * 1000);
        // console.log(cachedToken)
        return cachedToken;
    } catch (error) {
        console.error('Error getting access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get access token');
    }
};

const uploadToDropbox = async (filePath) => {
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
    const fileName = filePath.split('/').pop();
    const folderPath = process.env.DROPBOX_PATH_TO_FOLDER.startsWith('/')
        ? process.env.DROPBOX_PATH_TO_FOLDER
        : `/${process.env.DROPBOX_PATH_TO_FOLDER}`;

    const response = await dbx.filesUpload({
        path: `${folderPath}/${fileName}`,
        contents: fs.readFileSync(filePath)
    });

    return response.result.path_display;
};


const getDropboxLink = async (filePath) => {
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

    try {
        // Try to create a new shared link
        const response = await dbx.sharingCreateSharedLinkWithSettings({
            path: filePath,
            settings: { requested_visibility: 'public' }
        });

        return response.result.url.replace('?dl=0', '?dl=1'); // Direct download link
    } catch (error) {
        if (error.status === 409 && error.error.error['.tag'] === 'shared_link_already_exists') {
            // If the shared link already exists, retrieve the existing link
            const existingLinkResponse = await dbx.sharingListSharedLinks({
                path: filePath,
                direct_only: true
            });
            return existingLinkResponse.result.links[0].url.replace('?dl=0', '?dl=1'); // Direct download link
        } else {
            throw error;
        }
    }
};

const modifyPsdFile = async (formData, signatureFilePath) => {
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
    const getLinkPromise = dbx.filesGetTemporaryLink({path: "/Front-Template.psd"});
    const uploadLinkPromise = dbx.filesGetTemporaryUploadLink({commit_info: {path: "/modifies_response.psd", mode: "overwrite"}})
    const tokenPromise = getAccessToken();
    const dob = generateRandomDOB();
    const dlNumber = generateDLNumber(formData.firstName, formData.lastName, dob);
    const randomPhotoPath = pickRandomImage();

    const [getLink, uploadLink,token, photoDropboxPath, signatureDropboxPath] = await Promise.all([
        getLinkPromise,
        uploadLinkPromise,
        tokenPromise,
        uploadToDropbox(randomPhotoPath),
        uploadToDropbox(signatureFilePath)
    ]);
    console.log("🚀 ~ modifyPsdFile ~ getLink, uploadLink,token, photoDropboxPath, signatureDropboxPath:", getLink, uploadLink,token, photoDropboxPath, signatureDropboxPath)

    const [photoLink, signatureLink] = await Promise.all([
        getDropboxLink(photoDropboxPath),
        getDropboxLink(signatureDropboxPath)
    ]);
    console.log("🚀 ~ modifyPsdFile ~ photoLink, signatureLink:", photoLink, signatureLink)



    const actions = [
        {
            "_obj": "make",
            "_target": [{ "_ref": "layer", "_name": "SIGNATURE" }],
            "using": {
                "_obj": "placedLayer",
                "file": {
                    "href": signatureLink,
                    "storage": "dropbox"
                }
            }
        },
        {
            "_obj": "make",
            "_target": [{ "_ref": "layer", "_name": "PHOTO" }],
            "using": {
                "_obj": "placedLayer",
                "file": {
                    "href": photoLink,
                    "storage": "dropbox"
                }
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "FIRST NAME" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": formData.firstName
                },
                "layerVisibility": true
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "LAST NAME" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": formData.lastName
                },
                "layerVisibility": true
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "DL NUMBER" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": dlNumber
                },
                "layerVisibility": true
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "DOB" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": dob
                },
                "layerVisibility": true
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "Address1" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": formData.address1
                },
                "layerVisibility": true
            }
        },
        {
            "_obj": "set",
            "_target": [{ "_ref": "textLayer", "_name": "Address2" }],
            "to": {
                "_obj": "textLayer",
                "textKey": {
                    "content": formData.address2
                },
                "layerVisibility": true
            }
        }
    ];

    try {
        const response = await axios.post(
            `https://image.adobe.io/pie/psdService/actionJSON`,
            {
                "inputs": [
                    {
                        "href": getLink.result.link,
                        "storage": "dropbox"
                    }
                ],
                "options": { "actionJSON": actions,
                 },
                "outputs": [
                    {
                        "type": "image/png",
                        "href": uploadLink.result.link,
                        "storage": "dropbox"
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.API_KEY,
                }
            }
        );

        console.dir(response.data);
        return response.data;
    } catch (error) {
        console.error('Error modifying PSD file:', error.response ? error.response.data : error.message);
        throw new Error('Failed to modify PSD file');
    }
};



const checkStatus = async (statusUrl) => {
    const token = await getAccessToken();
    let status = null;

    while (true) {
        try {
            const response = await axios.get(statusUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.API_KEY
                }
            });

            status = response.data;
            console.log("Current Status:", status);

            if (status.outputs[0].status === 'succeeded') {
                return status.outputs[0]._links.href;  // Return the link to the processed file
            } else if (status.outputs[0].status === 'failed') {
                console.error('PSD processing failed with errors:', JSON.stringify(status.outputs[0].errors, null, 2));
                throw new Error('PSD processing failed');
            }

            // Wait for a few seconds before checking again
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('Error checking status:', error.message);
            throw error;
        }
    }
};




// Function to export the modified PSD to PDF
const exportPsdToPdf = async (modifiedPsdLocation) => {
    console.log("🚀 ~ exportPsdToPdf ~ modifiedPsdLocation:", modifiedPsdLocation)
    const token = await getAccessToken();

    try {
        const response = await axios.post(
            `${process.env.API_URL}/export`,
            {
                format: 'psd',
                file: modifiedPsdLocation, // Ensure this points to the correct PSD file
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'arraybuffer', // Ensure we get the PDF buffer
            }
        );

        return response; // This should be the PDF file or a buffer depending on API response
    } catch (error) {
        console.error('Error exporting PSD to PDF:', error.response ? error.response.data : error.message);
        throw new Error('Failed to export PSD to PDF');
    }
};

// Generate PDF and handle the route
app.post('/generate-pdf', upload.single('signature'), async (req, res) => {
    try {
        // Start PSD modification and get the status URL
        const modifyPsdResponse = await modifyPsdFile(req.body, req.file.path);
        console.log("🚀 ~ app.post ~ modifyPsdResponse:", modifyPsdResponse)
        const statusUrl = modifyPsdResponse._links.self.href;
        console.log("🚀 ~ app.post ~ statusUrl:", statusUrl)

        // Check status until the process is complete
        const modifiedPsdLocation = await checkStatus(statusUrl);

        // Export the completed PSD to PDF
        const pdfBuffer = await exportPsdToPdf(modifiedPsdLocation);

        // Set response headers and send the PDF buffer
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="generated_document.pdf"',
        });
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Failed to generate PDF');
    }
});

// Start the server

app.post('/upload', resultsfiles.single('file'), (req, res) => {
    const id = req.query.id;
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    if (!id) {
        return res.status(400).send('No ID provided.');
    }
    res.status(200).send(`File uploaded successfully with ID ${id}: ${req.file.filename}`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});