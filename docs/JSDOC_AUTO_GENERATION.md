# JSDoc Auto-Generation Setup

This document describes the automatic API documentation generation system from JSDoc comments.

## Overview

The project uses JSDoc comments in route files to automatically generate API documentation. This ensures that:
- Documentation stays in sync with code
- API changes are reflected immediately
- Documentation is always up-to-date

## Tools and Scripts

### 1. Test Script: `scripts/test-jsdoc-documentation.js`

Verifies that route files have complete JSDoc documentation.

**Usage:**
```bash
npm run test:jsdoc-documentation
```

**What it checks:**
- Setup functions have JSDoc with `@param` tags
- Route handlers have JSDoc comments
- JSDoc includes required tags: `@route`, `@param`, `@returns`, `@example`
- Helper functions are documented

### 2. Generation Script: `scripts/generate-api-docs.js`

Extracts JSDoc comments and generates markdown API documentation.

**Usage:**
```bash
npm run docs:generate
```

**Output:**
- Default: `docs/API_REFERENCE_GENERATED.md`
- Custom: `node scripts/generate-api-docs.js [output-file]`

**What it generates:**
- Complete API reference from JSDoc comments
- Organized by route file/module
- Includes parameters, return types, errors, examples

## JSDoc Standards

All route handlers should follow this pattern:

```javascript
/**
 * GET /api/admin/resource - Description
 * 
 * Detailed description of what the endpoint does.
 * 
 * @route GET /api/admin/resource
 * @middleware requireAdmin, tenantLoader
 * @param {ExpressRequest} req - Express request object
 * @param {ExpressRequest.body} req.body - Request body
 * @param {string} req.body.field - Field description
 * @param {Express.Response} res - Express response object
 * 
 * @returns {Object} Response object
 * @returns {boolean} returns.success - Whether operation succeeded
 * 
 * @throws {400} Bad Request - If validation fails
 * @throws {500} Internal Server Error - If server error occurs
 * 
 * @example
 * // Request
 * GET /api/admin/resource
 * 
 * // Response
 * {
 *   success: true,
 *   data: [...]
 * }
 */
```

## Integration with CI/CD

### Recommended Setup

Add to your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Test JSDoc Documentation
  run: npm run test:jsdoc-documentation

- name: Generate API Documentation
  run: npm run docs:generate

- name: Check for documentation changes
  run: |
    git diff --exit-code docs/API_REFERENCE_GENERATED.md || \
    (echo "API documentation changed. Please commit the changes." && exit 1)
```

### Pre-commit Hook (Optional)

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm run test:jsdoc-documentation
if [ $? -ne 0 ]; then
    echo "JSDoc documentation tests failed. Please fix documentation."
    exit 1
fi
```

## Alternative Tools

If you want more advanced features, consider:

### 1. jsdoc-to-markdown

```bash
npm install --save-dev jsdoc-to-markdown
```

More powerful JSDoc parser with better markdown generation.

### 2. TypeDoc

For TypeScript projects, TypeDoc provides excellent API documentation generation.

### 3. Swagger/OpenAPI

For REST API documentation, consider:
- `swagger-jsdoc` - Generate OpenAPI spec from JSDoc
- `swagger-ui-express` - Serve interactive API docs

## Maintenance

### When to Regenerate

- After adding new routes
- After modifying route signatures
- Before releases
- In CI/CD pipeline

### Keeping Documentation Updated

1. **Write JSDoc as you code** - Don't leave it for later
2. **Run tests regularly** - `npm run test:jsdoc-documentation`
3. **Regenerate before releases** - `npm run docs:generate`
4. **Review generated docs** - Ensure examples are accurate

## Troubleshooting

### Test Failures

If `test:jsdoc-documentation` fails:
1. Check which route is missing documentation
2. Add JSDoc following the standard pattern
3. Ensure all required tags are present

### Generation Issues

If `docs:generate` produces incomplete output:
1. Verify JSDoc syntax is correct
2. Check that `@route` tags are properly formatted
3. Ensure examples are within `@example` blocks

## Future Improvements

Potential enhancements:
- [ ] Support for OpenAPI/Swagger generation
- [ ] Interactive API documentation (Swagger UI)
- [ ] Integration with Postman collection generation
- [ ] Automatic example validation
- [ ] Link checking in generated docs


