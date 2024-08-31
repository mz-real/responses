const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));  // Serve static files

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
    try {
        const response = await axios.post('https://image.adobe.io/pie/psdService/operations', null, {
            params: {
                grant_type: 'client_credentials',
                client_id: 'f468b5b683524c80ad0ef0e7eee9f50e',
                client_secret: 'p8e-Rv4c0mjicafyi7F40xHeCgHa04pkyuW2',
                scope: 'openid,AdobeID,read_organizations',
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error getting access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to get access token');
    }
};

getAccessToken().then(token => {
    console.log('Token received:', token);
}).catch(error => {
    console.error('Failed to get token:', error);
});

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
        const response = await axios.post(
            `${process.env.API_URL}/operations`,
            { operations },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const modifiedPsdLocation = response.data.output; // Assuming the API returns the location of the modified PSD file

        return modifiedPsdLocation; // You can then export this to PDF
    } catch (error) {
        console.error('Error modifying PSD file:', error);
        throw new Error('Failed to modify PSD file');
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
                file: modifiedPsdLocation, // Ensure this points to the correct PSD file
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data; // This should be the PDF file or a link to download it
    } catch (error) {
        console.error('Error exporting PSD to PDF:', error);
        throw new Error('Failed to export PSD to PDF');
    }
};

// Generate PDF and handle the route
app.post('/generate-pdf', upload.single('signature'), async (req, res) => {
    try {
        const modifiedPsdLocation = await modifyPsdFile(req.body, req.file.path);
        const pdfBuffer = await exportPsdToPdf(modifiedPsdLocation);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="generated_document.pdf"',
        });
        res.send(pdfBuffer); // Ensure pdfBuffer is the actual PDF content
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).send('Failed to generate PDF');
    }
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
