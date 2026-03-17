// ArcNode Admin — Supabase Storage Helper
// ==========================================

const Storage = {
  /**
   * Upload a file to Supabase Storage
   * @param {string} bucket - Bucket name
   * @param {string} path - File path within bucket (e.g. companyId/vehicleId/file.pdf)
   * @param {File} file - File object to upload
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {object} { url, error }
   */
  async upload(bucket, path, file, onProgress) {
    try {
      // Use XMLHttpRequest for progress tracking
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `${SUPA_URL}/storage/v1/object/${bucket}/${path}`;

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const publicUrl = `${SUPA_URL}/storage/v1/object/public/${bucket}/${path}`;
            resolve({ url: publicUrl, error: null });
          } else {
            let errMsg = `Upload failed (${xhr.status})`;
            try { errMsg = JSON.parse(xhr.responseText).message || errMsg; } catch(e) {}
            resolve({ url: null, error: errMsg });
          }
        });

        xhr.addEventListener('error', () => {
          resolve({ url: null, error: 'Network error during upload' });
        });

        xhr.open('POST', url);
        xhr.setRequestHeader('apikey', SUPA_KEY);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.send(file);
      });
    } catch (e) {
      return { url: null, error: e.message };
    }
  },

  /**
   * Delete a file from Supabase Storage
   * @param {string} bucket - Bucket name
   * @param {string} path - File path within bucket
   */
  async remove(bucket, path) {
    try {
      const res = await fetch(`${SUPA_URL}/storage/v1/object/${bucket}/${path}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`
        }
      });
      return { error: res.ok ? null : `Delete failed (${res.status})` };
    } catch (e) {
      return { error: e.message };
    }
  },

  /**
   * Get authenticated download URL for a private file
   * @param {string} bucket - Bucket name
   * @param {string} path - File path within bucket
   * @param {number} expiresIn - Seconds until URL expires (default 3600)
   */
  async getSignedUrl(bucket, path, expiresIn = 3600) {
    try {
      const res = await fetch(`${SUPA_URL}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ expiresIn })
      });
      if (!res.ok) return { url: null, error: `Sign failed (${res.status})` };
      const data = await res.json();
      return { url: `${SUPA_URL}/storage/v1${data.signedURL}`, error: null };
    } catch (e) {
      return { url: null, error: e.message };
    }
  }
};

window.Storage = Storage;
