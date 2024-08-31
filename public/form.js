document.getElementById('pdfForm').addEventListener('submit', async function (event) {
    event.preventDefault(); // Prevent the default form submission

    console.log('Form submission intercepted. Preparing to send data...');

    const formData = new FormData(this);

    // Log the formData for debugging purposes
    for (let [key, value] of formData.entries()) {
        console.log(`${key}: ${value}`);
    }

    try {
        const response = await fetch('/generate-pdf', {
            method: 'POST',
            body: formData
        });

        console.log('Request sent. Awaiting response...');

        if (response.ok) {
            console.log('PDF generated successfully. Preparing to download...');
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'generated_document.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } else {
            console.error('Failed to generate PDF. Server responded with status:', response.status);
            // console.log(response);
            // alert('Failed to generate PDF. Please check the console for more details.');
        }
    } catch (error) {
        console.error('An error occurred during the PDF generation process:', error);
        alert('An error occurred while generating the PDF. Please check the console for more details.');
    }
});
