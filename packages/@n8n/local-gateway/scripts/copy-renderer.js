const fs = require('fs');

function main() {
	fs.mkdirSync('dist/renderer', { recursive: true });
	['index.html', 'styles.css'].forEach((f) =>
		fs.copyFileSync('src/renderer/' + f, 'dist/renderer/' + f),
	);
}

main();
