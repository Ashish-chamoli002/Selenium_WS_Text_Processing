// elpais-scraper.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Selenium WebDriver
const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');


// -------------------------------------------
// Utility: Create a Selenium WebDriver (Chrome)
// -------------------------------------------
async function createWebDriver() {
  const chromeOptions = new chrome.Options().addArguments('--lang=es');
  
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(chromeOptions)
    .build();

  // Maximize window, if desired
  await driver.manage().window().maximize();
  

  return driver;
}
// -------------------------------------------
// Accept Cookies If Present
// -------------------------------------------
async function acceptCookiesIfPresent(driver) {
  try {
    
    const acceptButton = await driver.wait(
      until.elementLocated(By.id('didomi-notice-agree-button')),
      2000
    );

    // Once located, click the button
    await acceptButton.click();

    // Optional: brief wait to ensure the acceptance is processed
    //await driver.sleep(1000);

    console.log("Cookie consent accepted.");

  } catch (err) {
    // If the button isn't found within 10s or another error occurs, log it
    console.log("Cookie consent button not found or could not be clicked:", err.message);
  }
}

// ----------------------------------------------
// 1. SCRAPE FIRST 5 ARTICLES FROM OPINION SECTION
// ----------------------------------------------
async function scrapeOpinionSection(driver, numArticles = 5) {
  const url = 'https://elpais.com/opinion/';
  await driver.get(url);
  
  let pageState = await driver.executeScript("return document.readyState");
if (pageState === "complete") {
  console.log("Document is fully loaded!");
}

  
  await acceptCookiesIfPresent(driver);

  let articlesData = [];

  
  let articleElements = await driver.findElements(By.css('article h2 a'));
  articleElements = articleElements.slice(0, numArticles);
  let links = [];
  for (let element of articleElements) {
    let href = await element.getAttribute('href');
    links.push(href);
  }
  

  for (let link of links) {
    await driver.get(link);
    
    let titleElement = await driver.findElement(By.css('article h1'));
    let titleText = await titleElement.getText();
    console.log("Title", titleText);
    
    let paragraphs = [];
      
    paragraphs = await driver.findElements(
      By.css("[data-dtm-region='articulo_cuerpo'] p")
    );
      

      paragraphs = paragraphs.slice(0, 3);
      
      

      let contentTexts = [];
      for (let p of paragraphs) {
        let text = await p.getText();
        console.log("tets", text);
        contentTexts.push(text);
      }

      let fullContent = contentTexts.join(' ');
      let imageUrl = null;
      try {
        let imgElement = await driver.findElement(By.css('figure img'));
        imageUrl = await imgElement.getAttribute('src');
      } catch (imgErr) {
        // If no cover image found, do nothing
      }
      articlesData.push({
        title: titleText,
        content: fullContent,
        imageUrl: imageUrl
      });
  }  

  return articlesData;
}

// ------------------------------------
// 2. DOWNLOAD COVER IMAGE (IF AVAILABLE)
// ------------------------------------
async function downloadImage(imageUrl, saveDir = 'images', filePrefix = 'cover') {
  if (!imageUrl) return null;

  // Ensure the directory exists
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
  }

  // Build a filename from the URL or a random name
  const filename = filePrefix + '_' + path.basename(imageUrl.split('?')[0]);
  const filepath = path.join(saveDir, filename);

  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
    if (response.status === 200) {
      fs.writeFileSync(filepath, response.data);
      return filepath;
    }
  } catch (err) {
    console.log(`Error downloading image from ${imageUrl}:`, err.message);
  }
  return null;
}

// -------------------------------------
// 3. TRANSLATE TITLES TO ENGLISH
// -------------------------------------
async function translateTitles(titles) {
  let translatedTitles = [];

  for (let title of titles) {
    
    const options = {
      method: 'POST',
      url: 'https://rapid-translate-multi-traduction.p.rapidapi.com/t',
      headers: {
        'x-rapidapi-key': '2d2c91476bmsh92ae1fee44094cfp131255jsne8e70089c614', 
        'x-rapidapi-host': 'rapid-translate-multi-traduction.p.rapidapi.com',
        'Content-Type': 'application/json'
      },
      data: {
        from: 'es',        
        to: 'en',          
        q: title           
      }
    };

    try {
      // Make the API request
      const response = await axios.request(options);
      let translatedText = response.data
      
      translatedTitles.push(translatedText || '');
    } catch (error) {
      console.error(`Error translating "${title}":`, error.message);
      // Fall back to the original title if translation fails
      translatedTitles.push(title);
    }
  }

  return translatedTitles;
}

// ---------------------------------------------------
// 4. ANALYZE TRANSLATED TITLES FOR REPEATED WORDS
// ---------------------------------------------------
function analyzeRepeatedWords(translatedTitles, threshold = 2) {
  let wordCount = {};

  for (let t of translatedTitles) {
    let words = t.toLowerCase().split(/\s+/);
    for (let w of words) {
      wordCount[w] = (wordCount[w] || 0) + 1;
    }
  }

  for (let [word, count] of Object.entries(wordCount)) {
    if (count > threshold) {
      console.log(`Repeated word "${word}" appears ${count} times.`);
    }
  }
}

// --------------------------------------------------
// 5. MAIN SCRIPT - LOCAL EXECUTION
// --------------------------------------------------
async function main() {
  let driver = null;
  try {
    
    driver = await createWebDriver();

    
    const articles = await scrapeOpinionSection(driver, 5);

    
    console.log('SCRAPED ARTICLES (IN SPANISH):');
    articles.forEach((article, idx) => {
      console.log(`\nArticle ${idx + 1}:`);
      console.log(`Title (ES): ${article.title}`);
      console.log(`Content (ES): ${article.content.substring(0, 200)}...`); 

      if (article.imageUrl) {
        downloadImage(article.imageUrl)
          .then((filepath) => {
            if (filepath) {
              console.log(`Cover image saved: ${filepath}`);
            } else {
              console.log('No cover image saved.');
            }
          })
          .catch((err) => console.error(err));
      } else {
        console.log('No cover image found.');
      }
    });

    // 4) Translate titles
    const spanishTitles = articles.map(a => a.title);
    const englishTitles = await translateTitles(spanishTitles);

    // Print translated headers
    console.log('\nTRANSLATED TITLES (ES -> EN):');
    englishTitles.forEach((t, i) => {
      console.log(`Article ${i + 1} Title (EN): ${t}`);
    });

    // 5) Analyze repeated words
    console.log('\nREPEATED WORDS IN TRANSLATED TITLES:');
    analyzeRepeatedWords(englishTitles, 2);

  } catch (err) {
    console.error('Error in main:', err);
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}


main();