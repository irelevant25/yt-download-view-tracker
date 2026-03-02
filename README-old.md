To run the script locally when developing or require to debug the script:
> npm start
It will automatically switch nodejs version based on the package.json

To export it for browser usage:
> npm run package
It will create an exe portable in the dist. Needs to be moved to the root of this project with name **youtube-checker.exe**


- In dev environment is not possbile to change task manager icon because the app is running from the electron.exe with its own icon.

Custom notification implementation:
```js
const { app } = require('electron');
const { join } = require('path')
const { notification } = require('@electron-uikit/notification');

notification.config({
    icon: join(__dirname, '/icon.png')
});

app.on('ready', async () => {
    notification.on('click', (data) => {
        console.log(`Notification clicked with data: ${JSON.stringify(data)}`);
    })

    notification.show({
        title: 'Electron UIKit',
        body: 'Gorgeous',
    });
});
```