// services/cloudinaryService.js
const cloudinary = require("cloudinary").v2;

// Configure Cloudinary from environment variables
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Uploads an image file buffer to Cloudinary getgo_profiles folder.
 * Returns a Promise resolving to the secure URL of the uploaded image.
 */
const uploadBuffer = (buffer) => {
    return new Promise((resolve, reject) => {
        // Fallback check if Cloudinary variables are not configured
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            console.warn("[Cloudinary] Credentials missing. Upload skipped.");
            return reject(new Error("Cloudinary credentials not configured. Please check your .env file."));
        }

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "getgo_profiles",
                resource_type: "image"
            },
            (error, result) => {
                if (error) {
                    console.error("[Cloudinary] Upload stream error:", error);
                    return reject(error);
                }
                resolve(result.secure_url);
            }
        );

        uploadStream.end(buffer);
    });
};

module.exports = { uploadBuffer };
