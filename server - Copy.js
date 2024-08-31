const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const querystring = require('querystring');

const app = express();
const upload = multer({ dest: 'uploads/' });

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

// Function to modify the PSD file with the provided form data and signature image
const modifyPsdFile = async (formData, signatureFilePath) => {
    const token = await getAccessToken();
    const dob = generateRandomDOB();
    const dlNumber = generateDLNumber(formData.firstName, formData.lastName, dob);
    const randomPhotoPath = pickRandomImage();

    // Define the operations on specific layers

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
            image: fs.readFileSync(randomPhotoPath), // Random image from folder
        },
        {
            name: 'Replace Image',
            layerName: 'SIGNATURE',
            image: fs.readFileSync(signatureFilePath), // Signature image uploaded by user
        },
    ];
    try {
    // console.log('HERE NOW');
        const response = await axios.post(
            `https://image.adobe.io/pie/psdService/documentOperations`,
            {
                inputs: [
                    {
                        storage: 'dropbox', // This is correct if using an external URL
                        href: `https://uc4931080be31742d57f79af101b.dl.dropboxusercontent.com/cd/0/get/CZG0SM_g7yAYKS2_Q64RErbrlpu50wg0g7FlgEwx0aza5imcE7SU4SHx3cgk7xCMleZs-bcTPFPRNTBgcd9O0lT4g7qSb_37xwiK5feZlkukFDA1EhZVBj9y6DjLijxXZZnP_xqnG-pMkNvfeWZ_KdEhAjkCYWUYzcorNGK6Ile7dQ/file`, // Link to PSD file
                    }
                ],
                outputs: [
                    {
                        storage: 'dropbox', // Change to 'adobe' or another valid value if 'internal' is not accepted
                        href: "https://content.dropboxapi.com/apitul/1/JvZIPl1Y-Bd43w", // Ensure this path matches the required pattern
                        type: "vnd.adobe.photoshop" // Change this to a valid MIME type if needed
                    }
                ],
                options: {
                    operations
                },
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'x-api-key': 'f468b5b683524c80ad0ef0e7eee9f50e',
                },
            }
        );
        // const modifiedPsdLocation = response.data.output; // Assuming the API returns the location of the modified PSD file
        // return modifiedPsdLocation; // You can then export this to PDF

        return response;

    } catch (error) {
         console.error('Error modifying PSD file:', error.response ? error.response.data : error.message);
        //throw new Error('Failed to modify PSD file');
    }
};

// Function to export the modified PSD to PDF
const exportPsdToPdf = async (modifiedPsdLocation) => {
    const token = await getAccessToken();

    try {
        const response = await axios.post(
            `${process.env.API_URL}/export`,
            {
                format: 'pdf',
                file: 'https://uc4931080be31742d57f79af101b.dl.dropboxusercontent.com/cd/0/get/CZG0SM_g7yAYKS2_Q64RErbrlpu50wg0g7FlgEwx0aza5imcE7SU4SHx3cgk7xCMleZs-bcTPFPRNTBgcd9O0lT4g7qSb_37xwiK5feZlkukFDA1EhZVBj9y6DjLijxXZZnP_xqnG-pMkNvfeWZ_KdEhAjkCYWUYzcorNGK6Ile7dQ/file', // Ensure this points to the correct PSD file
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
// Generate PDF and handle the route
app.post('/generate-pdf', upload.single('signature'), async (req, res) => {

    try {
    const modifiedPsdLocation = await modifyPsdFile(req.body, req.file.path);

    res.status(200).send({
        success: true,
        message: 'PSD generated successfully',
        modifiedPsdLocation: modifiedPsdLocation.status
    });

    }catch (error) {
        console.error('Error generating PSD:', error);
        res.status(500).send('Failed to generate PSD');
    }

});
// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});