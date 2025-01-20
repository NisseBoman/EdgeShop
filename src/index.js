/**
 * EdgeShop - Main Application Entry Point
 * A Fastly Compute@Edge e-commerce application that demonstrates edge computing capabilities
 */

/// <reference types="@fastly/js-compute" />

// Import Fastly-specific modules
import { includeBytes } from "fastly:experimental";  // For loading static files at compile time
import { KVStore } from "fastly:kv-store";          // For key-value store operations

/**
 * Static HTML Templates
 * Load all HTML templates at compile time for better performance
 * These templates contain placeholders that will be replaced with dynamic content
 */
const PAGES = {
  product: includeBytes("./src/product.html"),
  index: includeBytes("./src/index.html"),
  allProducts: includeBytes("./src/products.html"),
  about: includeBytes("./src/about.html"),
  cart: includeBytes("./src/cart.html")
};

/**
 * Common Response Headers
 * Define reusable header configurations for different content types
 */
const COMMON_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=432000"  // Cache for 5 days
};

/**
 * Image Response Headers Generator
 * Creates appropriate headers for image responses based on file extension
 */
const IMAGE_HEADERS = ext => ({
  "Content-Type": `image/${ext}`,
  "Cache-Control": "public, max-age=432000"
});

/**
 * Response Creator Helper
 * Standardizes response creation across the application
 * @param {string|Uint8Array} body - Response body content
 * @param {number} status - HTTP status code (default: 200)
 * @param {Object} headers - Response headers (default: COMMON_HEADERS)
 */
const createResponse = (body, status = 200, headers = COMMON_HEADERS) => {
  return new Response(body, {
    status,
    headers: new Headers(headers)
  });
};

/**
 * Cart Cookie Parser
 * Safely parses the cart cookie string into a JavaScript object
 * Returns empty object if cookie is invalid or missing
 */
function parseCart(cookie) {
  try {
    return cookie ? JSON.parse(decodeURIComponent(cookie)) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Cart Total Calculator
 * Calculates various totals for the shopping cart including:
 * - Subtotal
 * - VAT (25%)
 * - Shipping (free over $500)
 * - Total
 */
function calculateTotals(cart, products) {
  // Calculate subtotal by summing up (price * quantity) for each item
  const subtotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const product = products.Products.find(p => p.ProductId === parseInt(id));
    return sum + (product ? product.ProductPrice * qty : 0);
  }, 0);
  
  const vat = subtotal * 0.25;                    // 25% VAT
  const shipping = subtotal >= 500 ? 0 : 10;      // Free shipping over $500
  const total = subtotal + vat + shipping;
  
  return {
    subtotal: subtotal.toFixed(2),
    vat: vat.toFixed(2),
    shipping: shipping.toFixed(2),
    total: total.toFixed(2)
  };
}

/**
 * Template Variable Replacer
 * Replaces placeholder variables in HTML templates with actual content
 * Uses regex to replace all occurrences of each placeholder
 */
const replaceTemplateVars = (content, replacements) => {
  return Object.entries(replacements).reduce((acc, [key, value]) => 
    acc.replace(new RegExp(key, 'g'), value), content);
};

/**
 * Cart Cookie Handler
 * Manages cart cookie creation and updates
 * Sets appropriate headers for cart operations
 */
const handleCartCookie = (cart) => {
  return {
    'Location': '/cart',
    'Set-Cookie': `cart=${encodeURIComponent(JSON.stringify(cart))}; Max-Age=600; Path=/`  // 10-minute expiry
  };
};

/**
 * Cart Response Creator
 * Creates a redirect response for cart operations
 * Used after adding/updating cart items
 */
const createCartResponse = (headers) => {
  return new Response('', {
    status: 302,
    headers: new Headers(headers)
  });
};

/**
 * Route Handlers
 * Each handler manages a specific route in the application
 */

/**
 * Home Page Handler
 * Renders the main landing page with featured products
 * @param {KVStore} store - Key-value store instance for product data
 */
async function handleHome(store) {
  try {
    // Fetch product data from KV store
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.index);
    
    // Replace template variables for each featured product
    const replacements = {};
    products.Products.forEach((product, index) => {
      replacements[`{${index + 1}_Name}`] = product.ProductName;
      replacements[`{${index + 1}_product_id}`] = product.ProductId;
      replacements[`{${index + 1}_image_path}`] = product.ProductImage;
      replacements[`{${index + 1}_product_desc}`] = product.ProductDesc;
    });
    
    return createResponse(replaceTemplateVars(content, replacements));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Products Page Handler
 * Renders the product listing page showing all available products
 * @param {KVStore} store - Key-value store instance for product data
 */
async function handleProducts(store) {
  try {
    // Fetch all products from KV store
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.allProducts);
    
    // Generate HTML for each product in the catalog
    const productListHtml = products.Products.map(product => `
      <div class="product-list-item p-4">
        <div class="row align-items-center">
          <div class="col-auto">
             <a href="/product/${product.ProductId}/"<img src="/images/${product.ProductImage}" class="product-image" alt="${product.ProductName}"></a>
          </div>
          <div class="col">
            <h3 class="product-title mb-2">${product.ProductName}</h3>
            <p class="mb-2">${product.ProductDesc}</p>
            <div class="d-flex justify-content-between align-items-center">
              <span class="product-price">$${product.ProductPrice.toFixed(2)}</span>
              <div>
                <a href="/product/${product.ProductId}/" class="btn btn-primary">View Details</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
    
    content = content.replace('{all_json}', productListHtml);
    return createResponse(content);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * About Page Handler
 * Renders the static about page
 */
async function handleAbout() {
  try {
    let content = new TextDecoder().decode(PAGES.about);
    return createResponse(content);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Shopping Cart Handler
 * Renders the cart page with current items and totals
 * @param {KVStore} store - Key-value store instance for product data
 * @param {Request} req - HTTP request object containing cart cookie
 */
async function handleCart(store, req) {
  try {
    // Extract and parse cart cookie
    const cartCookie = req.headers.get('cookie')?.match(/cart=([^;]+)/)?.[1] || '';
    let cart = parseCart(cartCookie);
    
    // Fetch product data to get details for cart items
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.cart);
    
    // Generate HTML for each cart item
    const cartItemsHtml = Object.entries(cart)
      .map(([id, qty]) => {
        const product = products.Products.find(p => p.ProductId === parseInt(id));
        if (!product) return '';
        
        return createCartItemHtml(product, qty);
      })
      .filter(Boolean)
      .join('');
    
    // Calculate cart totals
    const totals = calculateTotals(cart, products);
    
    // Replace template variables with dynamic content
    content = replaceTemplateVars(content, {
      '{CART_ITEMS}': cartItemsHtml || '<p>Your cart is empty</p>',
      '{SUBTOTAL}': totals.subtotal,
      '{VAT}': totals.vat,
      '{SHIPPING}': totals.shipping,
      '{TOTAL}': totals.total,
      '{FREE_SHIPPING_MESSAGE}': parseFloat(totals.subtotal) >= 500 ? 
        '<div class="alert alert-success mb-2 py-2">✨ Free shipping applied!</div>' : 
        '<div class="text-muted small mb-2">Free shipping on orders over $500</div>'
    });
    
    // Return cart page with no-cache headers
    return new Response(content, {
      status: 200,
      headers: new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      })
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Route Handler Map
 * Maps URL paths to their corresponding handler functions
 */
const routeHandlers = {
  '/': handleHome,
  '/products': handleProducts,
  '/about': handleAbout,
  '/cart': handleCart
};

/**
 * Custom Error Classes
 * Extends Error for specific HTTP error scenarios
 */
class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.status = 404;
  }
}

/**
 * Error Handler
 * Centralizes error handling and creates appropriate error responses
 * Logs errors for debugging while presenting user-friendly messages
 */
const handleError = (err) => {
  console.error(err);
  if (err instanceof NotFoundError) {
    return createResponse(err.message, err.status);
  }
  return createResponse("Internal server error", 500);
};

/**
 * Cart Item HTML Generator
 * Creates the HTML markup for a single cart item
 * Includes product image, details, quantity controls, and remove button
 */
const createCartItemHtml = (product, qty) => `
  <div class="card mb-3">
    <div class="card-body">
      <div class="row">
        <div class="col-md-2">
          <img src="/images/${product.ProductImage}" class="img-fluid rounded" alt="${product.ProductName}">
        </div>
        <div class="col-md-5">
          <h5>${product.ProductName}</h5>
        </div>
        <div class="col-md-5">
          <div class="d-flex justify-content-between align-items-center">
            <form method="POST" action="/cart/update/${product.ProductId}" 
              class="d-flex align-items-center" onsubmit="return false;">
              <label class="me-2">Qty:</label>
              <input type="number" name="quantity" value="${qty}" min="0" max="99" 
                class="form-control form-control-sm" style="width: 70px;"
                onchange="this.form.submit()">
            </form>
            <span>$${(product.ProductPrice * qty).toFixed(2)}</span>
            <form method="POST" action="/cart/update/${product.ProductId}" 
              class="ms-3" onsubmit="return confirm('Remove this item from cart?');">
              <input type="hidden" name="quantity" value="0">
              <button type="submit" class="btn btn-link text-danger p-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash" viewBox="0 0 16 16">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                  <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const CACHE_HEADERS = {
  public: { "Cache-Control": "public, max-age=432000" },
  private: { "Cache-Control": "private, no-cache" },
  none: {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  }
};

/**
 * Main Request Handler
 * Entry point for all incoming requests to the application
 * @param {Request} req - The incoming HTTP request
 */
async function handleRequest(req) {
  try {
    // Initialize KV store connection
    const store = new KVStore('EdgeStoreItems');
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle cart operations (add/update/remove items)
    if (path.startsWith('/cart/')) {
      return handleCartOperation(req, store);
    }

    // Handle product detail pages
    if (path.startsWith('/product/')) {
      return handleProductDetail(path, store);
    }

    // Handle static image requests
    if (path.startsWith('/images/')) {
      return handleImageRequest(path, store);
    }

    // Route to appropriate handler or return 404
    const handler = routeHandlers[path];
    if (handler) {
      return handler(store, req);
    }

    throw new NotFoundError();
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Product Detail Page Handler
 * Renders the detailed view of a single product
 * @param {string} path - Request path containing product ID
 * @param {KVStore} store - Key-value store instance
 */
async function handleProductDetail(path, store) {
  try {
    // Extract product ID from URL
    const productId = parseInt(path.split('/')[2]);
    if (isNaN(productId)) throw new NotFoundError();

    // Fetch product data
    const items = await store.get('Items');
    if (!items) throw new NotFoundError();

    const products = await items.json();
    const product = products.Products.find(p => p.ProductId === productId);
    if (!product) throw new NotFoundError("Product not found");

    // Prepare template replacements
    let content = new TextDecoder().decode(PAGES.product);
    const replacements = {
      '{Product_Title}': product.ProductName,
      '{Product_Description}': product.ProductDesc,
      '{Product_Price}': product.ProductPrice.toFixed(2),
      '{Product_image_path}': product.ProductImage,
      '{Product_Id}': product.ProductId,
      '{JSON}': JSON.stringify(product, null, 2)
    };

    return createResponse(replaceTemplateVars(content, replacements));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Cart Operation Handler
 * Manages cart modifications (add/update/remove items)
 * @param {Request} req - The incoming HTTP request
 * @param {KVStore} store - Key-value store instance
 */
async function handleCartOperation(req, store) {
  try {
    if (req.method !== 'POST') {
      return createResponse("Method not allowed", 405);
    }

    // Parse cart cookie and form data
    const cartCookie = req.headers.get('cookie')?.match(/cart=([^;]+)/)?.[1] || '';
    let cart = parseCart(cartCookie);
    
    const formData = await req.formData();
    const quantity = parseInt(formData.get('quantity')) || 0;
    const productId = req.url.split('/').pop();

    // Update cart contents
    if (quantity > 0) {
      cart[productId] = Math.min(quantity, 99);  // Limit quantity to 99
    } else {
      delete cart[productId];  // Remove item if quantity is 0
    }

    // Create response with updated cart cookie
    return createCartResponse(handleCartCookie(cart));
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Image Request Handler
 * Serves product images with appropriate caching
 * @param {string} path - Request path containing image filename
 * @param {KVStore} store - Key-value store instance
 */
async function handleImageRequest(path, store) {
  try {
    const filename = path.split('/').pop();
    const ext = filename.split('.').pop().toLowerCase();
    
    // Fetch image data from KV store
    const imageData = await store.get(filename);
    if (!imageData) throw new NotFoundError("Image not found");

    // Return image with appropriate headers
    return new Response(imageData.body, {
      headers: new Headers(IMAGE_HEADERS(ext))
    });
  } catch (err) {
    return handleError(err);
  }
}

// Register the main request handler
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
