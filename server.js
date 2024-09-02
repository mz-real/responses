const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();
const { Dropbox } = require('dropbox');

const querystring = require('querystring');

const app = express();
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Specify the upload directory
    },
    filename: (req, file, cb) => {
        const id = req.query.id || Date.now().toString(); // Use timestamp if ID is missing
        const ext = path.extname(file.originalname);
        cb(null, `${id}${ext}`); // Use ID and original extension for filename
    }
});

const upload = multer({ storage });
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
    return path.join(imagesDir, randomImage);
};

// Get Access Token for Photoshop API
const getAccessToken = async () => {
    if (cachedToken && tokenExpiration > Date.now()) {
        console.log("Using cached access token.");
        return cachedToken;
    }

    try {
        console.log("Requesting new access token...");
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
        tokenExpiration = Date.now() + (55 * 60 * 1000);
        console.log("New access token obtained:", cachedToken);
        return cachedToken;
    } catch (error) {
        console.error('Error getting access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get access token');
    }
};

const uploadToDropbox = async (filePath) => {
    console.log("Uploading file to Dropbox:", filePath);
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
    const fileName = path.basename(filePath);
    const folderPath = process.env.DROPBOX_PATH_TO_FOLDER.startsWith('/')
        ? process.env.DROPBOX_PATH_TO_FOLDER
        : `/${process.env.DROPBOX_PATH_TO_FOLDER}`;

    const response = await dbx.filesUpload({
        path: `${folderPath}/${fileName}`,
        contents: fs.readFileSync(filePath)
    });

    console.log("File uploaded to Dropbox:", response.result.path_display);
    return response.result.path_display;
};

const getDropboxLink = async (filePath) => {
    console.log("Getting Dropbox link for:", filePath);
    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });

    try {
        const response = await dbx.sharingCreateSharedLinkWithSettings({
            path: filePath,
            settings: { requested_visibility: 'public' }
        });

        console.log("New Dropbox link created:", response.result.url);
        return response.result.url.replace('?dl=0', '?dl=1');
    } catch (error) {
        if (error.status === 409 && error.error.error['.tag'] === 'shared_link_already_exists') {
            console.log("Shared link already exists. Retrieving existing link.");
            const existingLinkResponse = await dbx.sharingListSharedLinks({
                path: filePath,
                direct_only: true
            });
            console.log("Existing Dropbox link:", existingLinkResponse.result.links[0].url);
            return existingLinkResponse.result.links[0].url.replace('?dl=0', '?dl=1');
        } else {
            console.error("Error getting Dropbox link:", error);
            throw error;
        }
    }
};

function isValidFileType(filePath) {
    const validExtensions = ['.psd', '.jpg', '.jpeg', '.tif', '.png'];
    const ext = path.extname(filePath).toLowerCase();
    const isValid = validExtensions.includes(ext);
    console.log(`File type validation for ${filePath}: ${isValid}`);
    return isValid;
}

const modifyPsdFile = async (formData, signatureFilePath) => {
    console.log("Modifying PSD file...");
    if (!isValidFileType(signatureFilePath)) {
        console.error(`Unsupported file type for: ${signatureFilePath}`);
        throw new Error('Unsupported file type');
    }

    const dbx = new Dropbox({ accessToken: process.env.DROPBOX_ACCESS_TOKEN });
    const getLinkPromise = dbx.filesGetTemporaryLink({path: "/Front-Template.psd"});
    const uploadLinkPromise = dbx.filesGetTemporaryUploadLink({commit_info: {path: "/response.psd", mode: "overwrite"}});
    const tokenPromise = getAccessToken();
    const dob = generateRandomDOB();
    const dlNumber = generateDLNumber(formData.firstName, formData.lastName, dob);
    const randomPhotoPath = pickRandomImage();

    const [getLink, uploadLink, token, photoDropboxPath, signatureDropboxPath] = await Promise.all([
        getLinkPromise,
        uploadLinkPromise,
        tokenPromise,
        uploadToDropbox(randomPhotoPath),
        uploadToDropbox(signatureFilePath)
    ]);

    console.log("Temporary link, upload link, token, photo, and signature paths:", getLink, uploadLink, token, photoDropboxPath, signatureDropboxPath);

    const [photoLink, signatureLink] = await Promise.all([
        getDropboxLink(photoDropboxPath),
        getDropboxLink(signatureDropboxPath)
    ]);


    const modifiable = [
        // {
        //     name: "FIRST NAME",
        //     text: {
        //         content: formData.firstName,
        //     }
        // },
        // {
        //     name: "LAST NAME",
        //     text: {
        //         content: formData.lastName,
        //     }
        // },
        // {
        //     name: "DL NUMBER",
        //     text: {
        //         content: dlNumber,
        //     }
        // },
        // {
        //     name: "DOB",
        //     text: {
        //         content: dob,
        //     }
        // },
        // {
        //     name: "Address1",
        //     text: {
        //         content: formData.address1,
        //     }
        // },
        // {
        //     name: "Address2",
        //     text: {
        //         content: formData.address2,
        //     }
        // },
        {
                        name: "SIGNATURE",
                        input: { href: signatureLink, storage: "dropbox" },
                    },
                    {
                        name: "PHOTO",
                        input: { href: photoLink, storage: "dropbox" },


                    }

    ];
    const operations = [
        { name: 'Replace Layer Text', layerName: 'FIRST NAME', text: formData.firstName },
        { name: 'Replace Layer Text', layerName: 'LAST NAME', text: formData.lastName },
        { name: 'Replace Layer Text', layerName: 'DL NUMBER', text: dlNumber },
        { name: 'Replace Layer Text', layerName: 'DOB', text: dob },
        { name: 'Replace Layer Text', layerName: 'Address1', text: formData.address1 },
        { name: 'Replace Layer Text', layerName: 'Address2', text: formData.address2 },
        {
            name: 'Replace Image',
            layerName: 'PHOTO',
            image: { href: photoLink, storage: "dropbox" }, // Random image from folder
        },
        {
            name: 'Replace Image',
            layerName: 'SIGNATURE',
            image: { href: signatureLink, storage: "dropbox" }, // Signature image uploaded by user
        },
    ];

    console.log("Photo and signature links:", photoLink, signatureLink);

    try {
        const response = await axios.post(
            `${process.env.API_URL}/smartObject`,
            {
                "inputs": [
                    {
                        "href": getLink.result.link,
                        "storage": "dropbox"
                    }
                ],
                options:{
                    layers: modifiable
                },
                // "options": {
                //     layers: [
                //         {
                //             name: "SIGNATURE",
                //             input: { href: signatureLink, storage: "dropbox" }
                //         },
                //         {
                //             name: "PHOTO",
                //             input: { href: photoLink, storage: "dropbox" }
                //         }
                //     ]
                // },
                "outputs": [
                    {
                        "type": "vnd.adobe.photoshop",
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

        console.log("PSD modification response:", response.data);
        return response.data;
    } catch (error) {
        console.error('Error modifying PSD file:', error.response ? error.response.data : error.message);
        throw new Error('Failed to modify PSD file');
    }
};

const checkStatus = async (statusUrl) => {
    console.log("Checking status for:", statusUrl);
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
                console.log("PSD processing succeeded:", status.outputs[0]._links.href);
                return status.outputs[0]._links.href;
            } else if (status.outputs[0].status === 'failed') {
                console.log("🚀 ~ checkStatus ~ status.outputs[0]:", status.outputs[0])
                console.error('PSD processing failed with errors:', JSON.stringify(status.outputs[0].errors, null, 3));
                throw new Error('PSD processing failed');
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error('Error checking status:', error.message);
            throw error;
        }
    }
};

const exportPsdToPdf = async (modifiedPsdLocation) => {
    console.log("Exporting PSD to PDF for:", modifiedPsdLocation);
    const token = await getAccessToken();

    try {
        const response = await axios.post(
            `${process.env.API_URL}/export`,
            {
                format: 'psd',
                file: modifiedPsdLocation,
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                responseType: 'arraybuffer',
            }
        );

        console.log("PDF export successful.");
        return response;
    } catch (error) {
        console.error('Error exporting PSD to PDF:', error.response ? error.response.data : error.message);
        throw new Error('Failed to export PSD to PDF');
    }
};

app.post('/generate-pdf', upload.single('signature'), async (req, res) => {
    try {
        console.log("Generating PDF...");
        const modifyPsdResponse = await modifyPsdFile(req.body, req.file.path);
        console.log("Modify PSD Response:", modifyPsdResponse);
        const statusUrl = modifyPsdResponse._links.self.href;
        console.log("Status URL:", statusUrl);

        const modifiedPsdLocation = await checkStatus(statusUrl);

        const pdfBuffer = await exportPsdToPdf(modifiedPsdLocation);

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

app.post('/upload', upload.single('file'), (req, res) => {
    const id = req.query.id;
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }
    if (!id) {
        return res.status(400).send('No ID provided.');
    }
    console.log(`File uploaded with ID ${id}: ${req.file.filename}`);
    res.status(200).send(`File uploaded successfully with ID ${id}: ${req.file.filename}`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
