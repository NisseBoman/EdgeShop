/**
 * EdgeShop - Main Application Entry Point
 * A Fastly Compute@Edge e-commerce application that demonstrates edge computing capabilities
 */

/// <reference types="@fastly/js-compute" />

// Import Fastly-specific modules
import { includeBytes } from "fastly:experimental";  // For loading static files at compile time
import { KVStore } from "fastly:kv-store";          // For key-value store operations
import { SimpleCache } from "fastly:cache";         // For caching individual products

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
 * Cache Configuration
 * Define different cache strategies using standard Cache-Control headers
 */
const CACHE_CONFIGS = {
  product: {
    "Cache-Control": "public, max-age=3600",         // 1 hour
    "Surrogate-Control": "max-age=3600"
  },
  static: {
    "Cache-Control": "public, max-age=86400",        // 24 hours
    "Surrogate-Control": "max-age=86400"
  },
  none: {
    "Cache-Control": "private, no-store, no-cache, must-revalidate",
    "Pragma": "no-cache"
  }
};

/**
 * Common Response Headers
 * Define reusable header configurations for different content types
 */
const COMMON_HEADERS = {
  "Content-Type": "text/html; charset=utf-8"
};

/**
 * Image Response Headers Generator
 * Creates appropriate headers for image responses based on file extension
 */
const IMAGE_HEADERS = ext => ({
  "Content-Type": `image/${ext}`,
  ...CACHE_CONFIGS.static
});

/**
 * Response Creator Helper
 */
const createResponse = (body, status = 200, headers = COMMON_HEADERS) => {
  const responseHeaders = new Headers({
    ...headers,
    "Fastly-Debug-TTL": headers["Cache-Control"] || "no-cache"
  });
  
  return new Response(body, {
    status,
    headers: responseHeaders
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
 * Product Cache Helper
 * Manages caching of individual products with a 60-minute TTL
 */
const PRODUCT_CACHE_TTL = 60; // 60 seconds TTL for testing

async function getProductFromCache(productId) {
  const cacheKey = `product:${productId}`;
  
  try {
    // Try to get product from cache first using SimpleCache static method
    const cachedProduct = await SimpleCache.get(cacheKey);
    if (cachedProduct) {
      return JSON.parse(cachedProduct);
    }
  } catch (e) {
    console.error('Cache get error:', e);
  }
  return null;
}

async function setProductInCache(productId, productData) {
  const cacheKey = `product:${productId}`;
  
  try {
    // Store product in cache with TTL using SimpleCache static method
    await SimpleCache.set(cacheKey, JSON.stringify(productData), { ttl: PRODUCT_CACHE_TTL });
  } catch (e) {
    console.error('Cache set error:', e);
  }
}

/**
 * API Response Headers
 * Define reusable header configurations for API responses
 */
const API_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

/**
 * API Response Creator Helper
 * Creates standardized API responses
 */
const createApiResponse = (data, status = 200, headers = API_HEADERS) => {
  const responseHeaders = new Headers({
    ...headers,
    "Fastly-Debug-TTL": headers["Cache-Control"] || "no-cache"
  });
  
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: responseHeaders
  });
};

/**
 * API Error Response Creator
 * Creates standardized error responses for the API
 */
const createApiError = (message, status = 400) => {
  return createApiResponse({
    error: {
      status,
      message
    }
  }, status);
};

/**
 * Product Filter and Sort Helper
 * Handles filtering and sorting of products based on query parameters
 */
function filterAndSortProducts(products, query) {
  let filteredProducts = [...products];

  // Apply filters
  if (query.has('search')) {
    const searchTerm = query.get('search').toLowerCase();
    filteredProducts = filteredProducts.filter(product => 
      product.ProductName.toLowerCase().includes(searchTerm) ||
      product.ProductDesc.toLowerCase().includes(searchTerm)
    );
  }

  if (query.has('min_price')) {
    const minPrice = parseFloat(query.get('min_price'));
    if (!isNaN(minPrice)) {
      filteredProducts = filteredProducts.filter(product => 
        product.ProductPrice >= minPrice
      );
    }
  }

  if (query.has('max_price')) {
    const maxPrice = parseFloat(query.get('max_price'));
    if (!isNaN(maxPrice)) {
      filteredProducts = filteredProducts.filter(product => 
        product.ProductPrice <= maxPrice
      );
    }
  }

  // Apply sorting
  const sort = query.get('sort');
  const order = query.get('order')?.toLowerCase() === 'desc' ? -1 : 1;

  switch(sort?.toLowerCase()) {
    case 'price':
      filteredProducts.sort((a, b) => (a.ProductPrice - b.ProductPrice) * order);
      break;
    case 'name':
      filteredProducts.sort((a, b) => a.ProductName.localeCompare(b.ProductName) * order);
      break;
    // Default sorting is by ID
    default:
      filteredProducts.sort((a, b) => (a.ProductId - b.ProductId) * order);
  }

  return filteredProducts;
}

/**
 * Multipart Form Parser
 * Parses multipart/form-data request body with proper binary handling
 */
async function parseMultipartForm(request) {
  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data");
  }

  const arrayBuffer = await request.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder();
  const text = decoder.decode(uint8Array);
  
  const boundary = contentType.split("boundary=")[1];
  const parts = text.split(`--${boundary}`);
  const formData = {};

  for (const part of parts) {
    if (part.trim() && !part.includes("--\r\n")) {
      const [headerText, ...bodyParts] = part.split("\r\n\r\n");
      const name = headerText.match(/name="([^"]+)"/)?.[1];
      
      if (name) {
        const body = bodyParts.join("\r\n\r\n").replace(/\r\n$/, "");
        
        // Handle file upload
        if (headerText.includes('filename="')) {
          const filename = headerText.match(/filename="([^"]+)"/)?.[1];
          const contentType = headerText.match(/Content-Type: (.+)/)?.[1];
          
          // Calculate the binary data position in the original array buffer
          const headerLength = headerText.length + 4; // +4 for \r\n\r\n
          const startPos = arrayBuffer.byteLength - uint8Array.length + part.indexOf(body) + headerLength;
          const endPos = startPos + body.length - 2; // -2 to remove trailing \r\n
          
          // Extract binary data as Uint8Array
          const binaryData = uint8Array.slice(startPos, endPos);
          
          formData[name] = {
            filename,
            contentType,
            data: binaryData
          };
        } else {
          formData[name] = body;
        }
      }
    }
  }

  return formData;
}

/**
 * Product Creator
 * Creates a new product and stores it in KV store
 */
async function createProduct(formData, store) {
  // Validate required fields
  if (!formData.name || !formData.price || !formData.description || !formData.image) {
    throw new Error("Missing required fields");
  }

  // Get existing products
  const items = await store.get('Items');
  if (!items) {
    throw new Error("Failed to get products");
  }

  const products = await items.json();
  
  // Generate new product ID
  const newProductId = Math.max(...products.Products.map(p => p.ProductId), 0) + 1;
  
  // Store image in KV store
  const imageFileName = `product_${newProductId}_${formData.image.filename}`;
  await store.put(imageFileName, formData.image.data.buffer, {
    metadata: { contentType: formData.image.contentType }
  });

  // Create new product object
  const newProduct = {
    ProductId: newProductId,
    ProductName: formData.name,
    ProductDesc: formData.description,
    ProductPrice: parseFloat(formData.price),
    ProductImage: imageFileName
  };

  // Add to products array
  products.Products.push(newProduct);

  // Update products in KV store
  await store.put('Items', JSON.stringify(products));

  // Invalidate cache
  await SimpleCache.purge(`product:${newProductId}`, { scope: "global" });

  return newProduct;
}

/**
 * Product Updater
 * Updates an existing product in KV store
 */
async function updateProduct(productId, formData, store) {
  // Validate required fields
  if (!formData.name || !formData.price || !formData.description) {
    throw new Error("Missing required fields");
  }

  // Get existing products
  const items = await store.get('Items');
  if (!items) {
    throw new Error("Failed to get products");
  }

  const products = await items.json();
  const productIndex = products.Products.findIndex(p => p.ProductId === parseInt(productId));
  
  if (productIndex === -1) {
    throw new Error("Product not found");
  }

  // Update product object
  const updatedProduct = {
    ...products.Products[productIndex],
    ProductName: formData.name,
    ProductDesc: formData.description,
    ProductPrice: parseFloat(formData.price)
  };

  // Handle image update if provided
  if (formData.image) {
    // Delete old image if it exists
    const oldImageFileName = products.Products[productIndex].ProductImage;
    try {
      await store.delete(oldImageFileName);
    } catch (error) {
      console.error('Failed to delete old image:', error);
    }

    // Store new image
    const imageFileName = `product_${productId}_${formData.image.filename}`;
    await store.put(imageFileName, formData.image.data.buffer, {
      metadata: { contentType: formData.image.contentType }
    });
    updatedProduct.ProductImage = imageFileName;
  }

  // Update products array
  products.Products[productIndex] = updatedProduct;

  // Update products in KV store
  await store.put('Items', JSON.stringify(products));

  // Invalidate cache
  await SimpleCache.purge(`product:${productId}`, { scope: "global" });

  return updatedProduct;
}

/**
 * Product Deleter
 * Deletes a product and its image from KV store
 */
async function deleteProduct(productId, store) {
  // Get existing products
  const items = await store.get('Items');
  if (!items) {
    throw new Error("Failed to get products");
  }

  const products = await items.json();
  const productIndex = products.Products.findIndex(p => p.ProductId === parseInt(productId));
  
  if (productIndex === -1) {
    throw new Error("Product not found");
  }

  // Delete product image
  const imageFileName = products.Products[productIndex].ProductImage;
  try {
    await store.delete(imageFileName);
  } catch (error) {
    console.error('Failed to delete image:', error);
  }

  // Remove product from array
  products.Products.splice(productIndex, 1);

  // Update products in KV store
  await store.put('Items', JSON.stringify(products));

  // Invalidate cache
  await SimpleCache.purge(`product:${productId}`, { scope: "global" });
}

/**
 * API Products Handler
 * Now with support for creating, updating, and deleting products
 */
async function handleApiProducts(req, store) {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const productId = pathParts[3];

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
      return createApiResponse({}, 204);
    }

    // Handle product creation
    if (req.method === 'POST' && !productId) {
      try {
        const formData = await parseMultipartForm(req);
        const newProduct = await createProduct(formData, store);
        
        return createApiResponse({
          data: newProduct,
          message: "Product created successfully"
        }, 201);
      } catch (error) {
        return createApiError(error.message, 400);
      }
    }

    // Handle product update
    if (req.method === 'PUT' && productId) {
      try {
        const formData = await parseMultipartForm(req);
        const updatedProduct = await updateProduct(productId, formData, store);
        
        return createApiResponse({
          data: updatedProduct,
          message: "Product updated successfully"
        }, 200);
      } catch (error) {
        return createApiError(error.message, error.message.includes("not found") ? 404 : 400);
      }
    }

    // Handle product deletion
    if (req.method === 'DELETE' && productId) {
      try {
        await deleteProduct(productId, store);
        
        return createApiResponse({
          message: "Product deleted successfully"
        }, 200);
      } catch (error) {
        return createApiError(error.message, error.message.includes("not found") ? 404 : 400);
      }
    }

    // Handle specific product request
    if (productId) {
      return handleApiProductDetail(productId, store);
    }

    // Handle product listing with filters and sorting
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");

    const products = await items.json();
    
    // Apply filters and sorting
    const filteredProducts = filterAndSortProducts(products.Products, url.searchParams);
    
    // Add cache headers for API response
    // Include query parameters in the cache key
    const cacheKey = `api-products-${url.search}`;
    const apiHeaders = {
      ...API_HEADERS,
      ...CACHE_CONFIGS.product,
      "Surrogate-Key": cacheKey,
      "Vary": "Accept-Encoding"
    };

    return createApiResponse({
      data: filteredProducts,
      meta: {
        total: filteredProducts.length,
        filters: {
          search: url.searchParams.get('search') || null,
          min_price: url.searchParams.get('min_price') || null,
          max_price: url.searchParams.get('max_price') || null,
          sort: url.searchParams.get('sort') || 'id',
          order: url.searchParams.get('order') || 'asc'
        }
      }
    }, 200, apiHeaders);

  } catch (err) {
    console.error('API Error:', err);
    return createApiError(err.message, err.status || 500);
  }
}

/**
 * API Product Detail Handler
 * Handles requests for specific products
 */
async function handleApiProductDetail(productId, store) {
  try {
    const id = parseInt(productId);
    if (isNaN(id)) {
      return createApiError("Invalid product ID", 400);
    }

    // Try to get product from cache first
    let product = await getProductFromCache(id);
    
    // If not in cache, fetch from KV store
    if (!product) {
      const items = await store.get('Items');
      if (!items) throw new NotFoundError("Products not found");

      const products = await items.json();
      product = products.Products.find(p => p.ProductId === id);
      
      if (!product) throw new NotFoundError("Product not found");
      
      // Store in cache for future requests
      await setProductInCache(id, product);
    }

    // Add cache headers for API response
    const apiHeaders = {
      ...API_HEADERS,
      ...CACHE_CONFIGS.product,
      "Surrogate-Key": `api-product-${id}`,
      "X-Cache-Status": product ? "HIT" : "MISS"
    };

    return createApiResponse({
      data: product
    }, 200, apiHeaders);

  } catch (err) {
    console.error('API Error:', err);
    return createApiError(err.message, err.status || 500);
  }
}

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
    
    // Add cache headers for home page
    const cacheHeaders = {
      ...CACHE_CONFIGS.static,
      "Surrogate-Key": "home-page"
    };

    return createResponse(replaceTemplateVars(content, replacements), 200, COMMON_HEADERS, cacheHeaders);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Products Page Handler
 * Renders the product listing page showing all available products
 * Now with caching support for individual products
 * @param {KVStore} store - Key-value store instance for product data
 */
async function handleProducts(store) {
  try {
    // Fetch all products from KV store
    const items = await store.get('Items');
    if (!items) throw new NotFoundError("Products not found");
    
    const products = await items.json();
    let content = new TextDecoder().decode(PAGES.allProducts);
    
    // Cache each product individually as we process them
    await Promise.all(products.Products.map(async (product) => {
      await setProductInCache(product.ProductId, product);
    }));
    
    // Generate HTML for each product in the catalog
    const productListHtml = products.Products.map(product => `
      <div class="product-list-item p-4">
        <div class="row align-items-center">
          <div class="col-auto">
            <a href="/product/${product.ProductId}/"><img src="/images/${product.ProductImage}" class="product-image" alt="${product.ProductName}"></a>
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
    
    // Add cache headers for product listing
    const cacheHeaders = {
      ...CACHE_CONFIGS.static,
      "Surrogate-Key": "product-listing"
    };

    return createResponse(content, 200, COMMON_HEADERS, cacheHeaders);
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
    // Add cache headers for static about page
    const cacheHeaders = {
      ...CACHE_CONFIGS.static,
      "Surrogate-Control": "max-age=86400"  // Cache at edge for 24 hours
    };
    return createResponse(content, 200, COMMON_HEADERS, cacheHeaders);
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
    
    // Return cart page with strict no-cache headers
    return new Response(content, {
      status: 200,
      headers: new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        "Vary": "Cookie"
      }),
      cacheOverride: CACHE_CONFIGS.none
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

    // Handle API requests
    if (path.startsWith('/api/products')) {
      return handleApiProducts(req, store);
    }

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
 * Now with caching support
 * @param {string} path - Request path containing product ID
 * @param {KVStore} store - Key-value store instance
 */
async function handleProductDetail(path, store) {
  try {
    const productId = parseInt(path.split('/')[2]);
    if (isNaN(productId)) throw new NotFoundError();

    // Try to get product from cache first
    let product = await getProductFromCache(productId);
    
    // If not in cache, fetch from KV store
    if (!product) {
      const items = await store.get('Items');
      if (!items) throw new NotFoundError();

      const products = await items.json();
      product = products.Products.find(p => p.ProductId === productId);
      
      if (!product) throw new NotFoundError("Product not found");
      
      // Store in cache for future requests
      await setProductInCache(productId, product);
    }

    let content = new TextDecoder().decode(PAGES.product);
    const replacements = {
      '{Product_Title}': product.ProductName,
      '{Product_Description}': product.ProductDesc,
      '{Product_Price}': product.ProductPrice.toFixed(2),
      '{Product_image_path}': product.ProductImage,
      '{Product_Id}': product.ProductId,
      '{JSON}': JSON.stringify(product, null, 2)
    };

    // Add cache headers for product pages
    const cacheHeaders = {
      ...COMMON_HEADERS,
      ...CACHE_CONFIGS.product,
      "Surrogate-Key": `product-${product.ProductId}`,
      "ETag": `"product-${product.ProductId}-${Date.now()}"`,
      "X-Cache-Status": product ? "HIT" : "MISS"  // Add cache status header
    };

    return createResponse(
      replaceTemplateVars(content, replacements),
      200,
      cacheHeaders
    );
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

    // Parse cart cookie
    const cartCookie = req.headers.get('cookie')?.match(/cart=([^;]+)/)?.[1] || '';
    let cart = parseCart(cartCookie);
    
    // Parse form data from request body
    const text = await req.text();
    const params = new URLSearchParams(text);
    const quantity = parseInt(params.get('quantity')) || 0;
    const productId = req.url.split('/').pop();

    // Update cart contents
    if (quantity > 0) {
      cart[productId] = Math.min(quantity, 99);  // Limit quantity to 99
    } else {
      delete cart[productId];  // Remove item if quantity is 0
    }

    // Add no-cache headers for cart operations
    const cartHeaders = {
      ...handleCartCookie(cart),
      ...CACHE_CONFIGS.none,
      "Vary": "Cookie"
    };

    return createCartResponse(cartHeaders);
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
    
    const imageData = await store.get(filename);
    if (!imageData) throw new NotFoundError("Image not found");

    const imageHeaders = {
      ...IMAGE_HEADERS(ext),
      "Surrogate-Key": `image-${filename}`
    };

    return new Response(imageData.body, {
      headers: new Headers(imageHeaders)
    });
  } catch (err) {
    return handleError(err);
  }
}

// Register the main request handler
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
