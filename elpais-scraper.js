const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Builder, By, Key, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function createWebDriver() {
  const chromeOptions = new chrome.Options()
    .addArguments('--lang=es')
    .addArguments('--headless')
    .addArguments('--disable-gpu')
    .addArguments('--no-sandbox')
    .addArguments('--disable-dev-shm-usage')
    .addArguments('--window-size=1920,1080')  // Set explicit window size
    .setPageLoadStrategy('normal');  // Changed to normal for better reliability
  
  return new Builder()
    .forBrowser('chrome')
    .setChromeOptions(chromeOptions)
    .build();
}

async function waitForElement(driver, selector, timeout = 10000) {
  try {
    await driver.wait(until.elementLocated(By.css(selector)), timeout);
    const element = await driver.findElement(By.css(selector));
    await driver.wait(until.elementIsVisible(element), timeout);
    return element;
  } catch (error) {
    console.log(`DEBUG: Timeout waiting for element: ${selector}`);
    return null;
  }
}

async function acceptCookiesIfPresent(driver) {
  try {
    // Wait for cookie banner to be visible
    await driver.wait(async () => {
      const banner = await driver.findElements(By.id('didomi-notice-agree-button'));
      return banner.length > 0;
    }, 5000);
    
    const acceptButton = await driver.findElement(By.id('didomi-notice-agree-button'));
    await driver.wait(until.elementIsVisible(acceptButton), 5000);
    await acceptButton.click();
    await driver.sleep(1000); // Wait for banner to disappear
    console.log("Cookie consent accepted.");
  } catch (err) {
    console.log("No cookie consent needed or error:", err.message);
  }
}

async function scrapeArticle(driver, url) {
  console.log(`\nDEBUG: Starting to scrape article at ${url}`);
  
  try {
    await driver.get(url);
    console.log('DEBUG: Page loaded');
    
    // Wait for full page load
    await driver.wait(until.elementLocated(By.css('body')), 10000);
    await driver.sleep(2000); // Give JavaScript time to render
    
    // Get title using multiple possible selectors
    let titleText = '';
    try {
      const titleSelectors = [
        'article h1',
        '.article_header h1',
        '[data-dtm-region="articulo_titulo"] h1',
        'h1.headline'
      ];
      
      for (const selector of titleSelectors) {
        const titleElement = await driver.findElements(By.css(selector));
        if (titleElement.length > 0) {
          titleText = await titleElement[0].getText();
          if (titleText) {
            console.log(`DEBUG: Found title using selector: ${selector}`);
            break;
          }
        }
      }
    } catch (titleErr) {
      console.log('DEBUG: Error getting title:', titleErr.message);
    }
    
    // Get paragraphs using multiple possible selectors
    let contentTexts = [];
    const paragraphSelectors = [
      "[data-dtm-region='articulo_cuerpo'] p",
      "article p",
      ".article_body p",
      ".articulo-cuerpo p"
    ];
    
    for (const selector of paragraphSelectors) {
      try {
        const paragraphs = await driver.findElements(By.css(selector));
        if (paragraphs.length > 0) {
          console.log(`DEBUG: Found paragraphs using selector: ${selector}`);
          for (let p of paragraphs.slice(0, 3)) {
            const text = await p.getText();
            if (text && text.trim()) {
              contentTexts.push(text);
            }
          }
          if (contentTexts.length > 0) break;
        }
      } catch (err) {
        console.log(`DEBUG: Error with selector ${selector}:`, err.message);
      }
    }
    
    // Get image
    let imageUrl = null;
    try {
      const imgSelectors = ['figure img', 'article img', '.article_image img'];
      for (const selector of imgSelectors) {
        const imgElements = await driver.findElements(By.css(selector));
        if (imgElements.length > 0) {
          imageUrl = await imgElements[0].getAttribute('src');
          if (imageUrl) {
            console.log(`DEBUG: Found image using selector: ${selector}`);
            break;
          }
        }
      }
    } catch (imgErr) {
      console.log('DEBUG: Error getting image:', imgErr.message);
    }

    console.log('DEBUG: Article scraped successfully');
    console.log(`DEBUG: Title length: ${titleText.length}`);
    console.log(`DEBUG: Content paragraphs: ${contentTexts.length}`);
    
    return {
      title: titleText,
      content: contentTexts.join(' '),
      imageUrl: imageUrl
    };
  } catch (err) {
    console.log('DEBUG: Error scraping article:', err.message);
    return {
      title: '',
      content: '',
      imageUrl: null
    };
  }
}

async function scrapeOpinionSection(driver, numArticles = 5) {
  const url = 'https://elpais.com/opinion/';
  console.log('DEBUG: Opening opinion section');
  await driver.get(url);
  await driver.sleep(2000); // Wait for initial load
  
  await acceptCookiesIfPresent(driver);
  
  console.log('DEBUG: Getting article links');
  const links = [];
  try {
    // Try multiple selectors for article links
    const linkSelectors = [
      'article h2 a',
      '.article_headline a',
      '.articulo h2 a'
    ];
    
    for (const selector of linkSelectors) {
      const elements = await driver.findElements(By.css(selector));
      console.log(`DEBUG: Found ${elements.length} links with selector: ${selector}`);
      
      for (const element of elements) {
        const href = await element.getAttribute('href');
        if (href && !links.includes(href)) {
          links.push(href);
        }
      }
      
      if (links.length >= numArticles) break;
    }
  } catch (err) {
    console.log('DEBUG: Error getting article links:', err.message);
  }
  
  console.log(`DEBUG: Found ${links.length} article links`);
  
  // Scrape articles sequentially to avoid overwhelming the server
  const articlesData = [];
  for (let i = 0; i < Math.min(links.length, numArticles); i++) {
    console.log(`DEBUG: Scraping article ${i + 1} of ${numArticles}`);
    const articleData = await scrapeArticle(driver, links[i]);
    articlesData.push(articleData);
  }
  
  return articlesData;
}

async function translateTitles(titles) {
  const results = [];
  
  for (const title of titles) {
    if (!title) {
      results.push('');
      continue;
    }
    
    try {
      const options = {
        method: 'POST',
        url: 'https://rapid-translate-multi-traduction.p.rapidapi.com/t',
        headers: {
          'x-rapidapi-key': '2d2c91476bmsh92ae1fee44094cfp131255jsne8e70089c614',
          'x-rapidapi-host': 'rapid-translate-multi-traduction.p.rapidapi.com',
          'Content-Type': 'application/json'
        },
        data: { from: 'es', to: 'en', q: title }
      };

      const response = await axios.request(options);
      results.push(response.data || title);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
    } catch (error) {
      console.log(`DEBUG: Translation error for "${title}":`, error.message);
      results.push(title);
    }
  }
  
  return results;
}

async function analyzeHeaders(englishTitles) {
  console.log('\nDEBUG: Analyzing translated headers');
  
  // Combine all titles and split into words
  const words = englishTitles
    .join(' ')
    .toLowerCase()
    // Remove punctuation and special characters
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2); // Filter out very short words
    
  // Count word occurrences
  const wordCount = words.reduce((acc, word) => {
    acc[word] = (acc[word] || 0) + 1;
    return acc;
  }, {});
  
  // Filter words that appear more than twice
  const repeatedWords = Object.entries(wordCount)
    .filter(([_, count]) => count > 2)
    .sort((a, b) => b[1] - a[1]); // Sort by frequency
    
  console.log('\nHeader Analysis Results:');
  if (repeatedWords.length === 0) {
    console.log('No words were repeated more than twice in the headers.');
  } else {
    console.log('Words repeated more than twice:');
    repeatedWords.forEach(([word, count]) => {
      console.log(`"${word}" appears ${count} times`);
    });
  }
  
  return repeatedWords;
}

async function main() {
  let driver = null;
  try {
    console.log('DEBUG: Creating WebDriver');
    driver = await createWebDriver();
    
    console.log('DEBUG: Starting article scraping...');
    const articles = await scrapeOpinionSection(driver, 5);
    
    console.log('DEBUG: Translating titles...');
    const spanishTitles = articles.map(a => a.title);
    const englishTitles = await translateTitles(spanishTitles);
    
    // Print results with validation
    articles.forEach((article, idx) => {
      console.log(`\nArticle ${idx + 1}:`);
      console.log(`Title (ES): ${article.title || 'Not found'}`);
      console.log(`Title (EN): ${englishTitles[idx] || 'Not found'}`);
      console.log(`Content Preview: ${article.content ? article.content.substring(0, 200) + '...' : 'No content found'}`);
    });
    
    console.log('\n=== Header Analysis ===');
    const repeatedWords = analyzeHeaders(englishTitles);
    
    // Additional statistics
    console.log('\nHeader Analysis Statistics:');
    console.log(`Total unique words analyzed: ${Object.keys(
      englishTitles.join(' ').toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .split(/\s+/)
        .reduce((acc, word) => {
          if (word.length > 2) acc[word] = true;
          return acc;
        }, {})
    ).length}`);
    console.log(`Number of words repeated more than twice: ${repeatedWords.length}`);
    
  } catch (err) {
    console.error('DEBUG: Fatal error in main:', err);
  } finally {
    if (driver) {
      await driver.quit();
    }
  }
}

main();