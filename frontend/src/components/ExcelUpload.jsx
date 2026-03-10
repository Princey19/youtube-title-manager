import React from 'react';

export default function ExcelUpload({ file, onFileChange, matchBy, onMatchByChange }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">Excel Upload</h2>
        <p className="card-subtitle">
          Upload an Excel file with columns: <strong>Id</strong>, <strong>title</strong>,{' '}
          <strong>label</strong>, <strong>acronym</strong>.
        </p>
      </div>
      <div className="card-body">
        <div className="field">
          <label className="label">Excel file (.xlsx)</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => onFileChange(e.target.files?.[0] || null)}
          />
          {file && <p className="hint">Selected: {file.name}</p>}
        </div>

        <div className="field">
          <label className="label">Match videos by</label>
          <select
            value={matchBy}
            onChange={(e) => onMatchByChange(e.target.value)}
          >
            <option value="id">Id only</option>
            <option value="title">Title only</option>
            <option value="both">Id or title</option>
          </select>
          <p className="hint">
            Matching will try the selected fields when finding the YouTube video for each row.
          </p>
        </div>
      </div>
    </div>
  );
}

