  

### Chrome Extension - ChatGPT backup tool


[ChatGPT-backup tool](https://chrome.google.com/webstore/detail/chatgpt-backup/majboohgjfdnegkhadaialohhlimolcc)  
  

Backup your OpenAI ChatGPT history in either JSON or Mardown format Easily backup one or all your chat conversations in JSON or MARKDOWN.

  

Key Features:

Open Source: Chat Exporter is fully open-source, allowing users and developers to explore its codebase, contribute improvements, and customize the extension as needed. [https://github.com/FredySandoval/ChatGPT-CHROME\_EXTENSION](https://github.com/FredySandoval/ChatGPT-CHROME_EXTENSION)

  

Simple Interface: Chat Exporter provides an intuitive user interface that makes downloading and managing chat data a breeze.

  

Multiple Format Support: Export your chats in JSON or Markdown format, ensuring compatibility with various data processing and analysis tools.

Real-time Progress Updates: Stay informed about the download progress with name-based updates, so you know exactly how much of your chat data has been downloaded.

  

Easy Installation: Get started with Chat Exporter in just a few clicks. Install the extension from the Chrome Web Store, and you're ready to export your chats.

Whether you need to back up your chat history, analyze conversations, or simply keep a record of your online interactions, Chat Exporter is the perfect solution for all your chat exporting needs. Install Chat Exporter today and take control of your chat data.

  

### Features:

  

You can download the Chat is currently opened in JSON or in Markdown. You can Download all Chats in one JSON file or a Zip file containing all the markdowns. Options page where offsets can be configure. The log appears in the extension, showing the number of downloaded chats. File Tree Explanation:

  
  
```txt
 +-----------------------------------+                                                                 
 | ChatGPT-backup                    |                                                                 
 |             +------+ +----------+ |                                                                 
 | Backup All: | json | | markdown | |                                                                 
 |             +------+ +----------+ |                                                                 
 |             +------+ +----------+ |                                                                 
 | Backup One: | json | | markdown | |                                                                 
 |             +------+ +----------+ |                                                                 
 +-----------------------------------+                                                                 
                                                                                                       
 chrome-extention/                                                                                     
 ├── icons/                                                                                            
 │   ├── icon16.png                                                                                    
 │   ├── icon32.png                                                                                    
 │   ├── icon48.png                                                                                    
 │   └── icon128.png                                                                                   
 ├── options/                                                                                          
 │   ├── options.html ---------- Set StartOffset, EndOffset.                                           
 │   └── options.js              and other markdown configs.                                           
 ├── popup/                                                                                            
 │   ├── FileSaver.js ---------- Open Source tool to save (to maximize compatibility)                  
 │   ├── jsZip.js -------------- For Markdown back, will put them all in zip file.                     
 │   ├── popup.html  ----------- The Extension index.html (the entry point)                            
 │   └── popup.js                                                                                      
 ├── scripts/                                                                                          
 │   └── content-script.js                                                                             
 ├── manifest.json  ------------ V3 type, permissions, etc.                                            
 └── service-worker.js --------- Code that interacts with host (chatgpt.com) .   

  ```
  

### Preview Tool | [ChatGPT-CHROME\_EXTENSION](https://fredysandoval.github.io/ChatGPT-CHROME_EXTENSION/)

  
  
![preview](https://raw.githubusercontent.com/abacaj/chatgpt-backup/main/assets/preview.png)
