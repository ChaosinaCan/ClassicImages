﻿/// <reference path="interfaces.ts" />
/// <reference path="lib/libgif.d.ts" />
/// <reference path="lib/ExifReader.d.ts" />

declare function postMessage(message: any): void;

var MIME_TYPES: { [key: string]: string[]; } = {
	'BMP':  ['image/bmp', 'image/x-windows-bmp'],
	'GIF':  ['image/gif'],
	'JPEG': ['image/jpeg', 'image/pjpeg'],
	'ICO':  ['image/x-icon'],
	'PGM':  ['image/x-portable-graymap'],
	'PNG':  ['image/png'],
	'SVG':  ['image/svg+xml', 'image/svg-xml'],
	'TIFF': ['image/tiff', 'image/x-tiff'],
	'WebP': ['image/webp'],
	'XBM':  ['image/x-xbitmap'],
}

onmessage = function(event) {
	var message = <IAnalyzeMessage>event.data;

	var xhr = new XMLHttpRequest();
	xhr.responseType = 'blob';
	xhr.addEventListener('load', (e) => {
		// Parse the image and pass back any new info we get
		parseImage(xhr.response, (err, info) => {
			if (err) {
				throw new Error(err);
			} else if (info === null) {
				endAnalysis();
			} else {
				sendInfo(info);
			}
		});
	});

	xhr.addEventListener('error', (e) => {
		throw new Error(xhr.status + ' ' + xhr.statusText);
	});

	xhr.addEventListener('loadend', (e) => {
		// Clean up the blob URL
		URL.revokeObjectURL(message.url);
	});
	xhr.open('get', message.url, true);
	xhr.send();
}

function getGenericImageData(type: string, data: ArrayBuffer): ImageInfo {
	return {
		mimeType: type,
		type: getImageType(type),
		fileSize: data.byteLength
	}
}

function getImageType(mimeType: string) {
	for (var key in MIME_TYPES) {
		if (MIME_TYPES.hasOwnProperty(key)) {
			if (MIME_TYPES[key].indexOf(mimeType.toLowerCase()) >= 0) {
				return key;
			}
		}
	}
	return null;
}

function parseImage(blob: Blob, callback: InfoCallback) {
	var fr = new FileReader();
	fr.addEventListener('load', (e) => {
		var info = getGenericImageData(blob.type, fr.result);

		// Send the info we've collected up to now
		callback(null, info);

		try {
			// Pick the right parser based on the image type
			switch (info.type) {
				case 'GIF':
					GifParser.parse(fr.result, info, callback);
					break;

				case 'JPEG':
					JpegParser.parse(fr.result, info, callback);
					break;

				default:
					// No further analysis to do. Send back a 'null' to indicate we're done.
					callback(null, null);
					break;
			}
		} catch (e) {
			callback(chrome.i18n.getMessage('error_analyze_failed', [e.toString()]), null);
		}
	});

	fr.addEventListener('error', (e) => {
		callback(chrome.i18n.getMessage('error_analyze_failed', [fr.error.toString()]), null);
	});

	fr.readAsArrayBuffer(blob);
}

function endAnalysis() {
	postMessage({
		action: 'done'
	});
	close();
}

function sendInfo(info: ImageInfo) {
	postMessage({
		action: 'info',
		data: info
	});
}

module GifParser {
	/** Implementation of libgif's stream class for ArrayBuffer data*/
	class BlobStream implements GifStream {
		private data: Uint8Array;
		private pos: number;

		constructor(buffer: ArrayBuffer) {
			this.data = new Uint8Array(buffer);
			this.pos = 0;
		}

		public read(length: number): string {
			var s = '';
			for (var i = 0; i < length; i++) {
				s += String.fromCharCode(this.readByte());
			}
			return s;
		}

		public readByte(): number {
			if (this.pos >= this.data.length) {
				throw new Error('Attempted to read past end of stream.');
			}
			return this.data[this.pos++] & 0xFF;
		}

		public readBytes(length: number): number[] {
			var bytes = [];
			for (var i = 0; i < length; i++) {
				bytes.push(this.readByte());
			}
			return bytes;
		}

		public readUnsigned(): number {
			var a = this.readBytes(2);
			return (a[1] << 8) + a[0];
		}

		public skip(length: number): void {
			this.pos += length;
		}
	}

	class Handler implements GifParseHandler {
		callback: Function;
		info: ImageInfo;
		animated: boolean;

		constructor(info: ImageInfo, callback: (err, info) => void) {
			this.callback = callback;
			this.animated = false;
			this.info = info;

			this.info.frames = 0;
			this.info.framerate = 0;
			this.info.duration = 0;
		}

		gce(block: GifGceBlock) {
			this.info.frames += 1;
			this.info.duration += block.delayTime / 100;
		}

		eof(block) {
			if (this.info.duration > 0) {
				this.info.framerate = this.info.frames / this.info.duration;
			} else {
				delete this.info.framerate;
				delete this.info.duration;
			}

			this.callback(null, this.info);
			this.callback(null, null);
		}
	}

	export function parse(buffer: ArrayBuffer, info: ImageInfo, callback: (err, info) => void) {
		importScripts('lib/libgif.js');
		var stream = new BlobStream(buffer);
		var handler = new Handler(info, callback);
		parseGIF(stream, handler);
	}
}

module JpegParser {
	export function parse(buffer: ArrayBuffer, info: ImageInfo, callback: (err, info) => void) {
		importScripts('lib/ExifReader.js');
		try {
			console.log('parsing exif');
			var exif = new ExifReader();
			exif.load(buffer);

			info.metadata = exif.getAllTags();
			console.log(info.metadata);

			callback(null, info);
			callback(null, null);
		} catch (e) {
			if (e instanceof Error && (<Error>e).message === 'No Exif data') {
				// Image doesn't have exif data. Ignore.
				callback(null, null);
			} else {
				throw e;
			}
		}
	}
}