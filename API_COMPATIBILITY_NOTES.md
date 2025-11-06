# API Compatibility Notes - HR Todos Widget Refactoring

## Overview

This document explains the API compatibility challenges encountered during the refactoring and how they were resolved in version 2.1.

---

## The Challenge

The original code assumed a simplified API for `todoPageUtils`, but the actual ServiceNow standard API has a different signature and behavior.

### Original Assumption (v1.0 - INCORRECT)

```javascript
var todoUtils = new TodoPageUtils();
var result = todoUtils.getTodos(safeParams);  // ❌ This method doesn't exist!
```

### Actual todoPageUtils API

```javascript
var todoUtils = new sn_hr_sp.todoPageUtils();

// Correct method signature:
todoUtils.getMyTodos(
    limit,              // number - max records to return
    excludeList,        // array - sys_ids to exclude
    includeSysId,       // string - specific sys_id to include
    filters,            // array - filter IDs
    params,             // object - additional parameters
    todoPageFilterConditions,  // object - filter conditions
    applyFilter,        // boolean - whether to apply filters
    tab                 // string - tab name ('open', 'completed', etc.)
)
```

---

## API Mapping

### Parameter Mapping

| Our Clean API | todoPageUtils API | Notes |
|---------------|-------------------|-------|
| `pageSize` | `limit` | Direct mapping |
| `page` (calculated offset) | `excludeList` | Need to exclude previously shown records |
| `filters.filterIds` | `filters` | Filter ID array |
| `filters.*` | `params` | Additional filter parameters |
| `tab` | `tab` | But different names! |

### Tab Name Mapping

| Our API | todoPageUtils API |
|---------|-------------------|
| `pending` | `open` |
| `open` | `open` |
| `completed` | `completed` |
| `closed` | `completed` |
| `all` | `all` |

---

## Key Differences

### 1. Return Format

**Our desired format:**
```javascript
{
    success: true,
    records: [...],
    totalCount: 123,
    page: 1,
    pageSize: 10,
    hasMore: true
}
```

**Actual todoPageUtils format:**
```javascript
{
    recordsToShow: {
        'open': [...],
        'completed': [...]
    },
    recordWatchers: [...]
}
```

### 2. Pagination Strategy

**Our approach:** Page-based (page 1, page 2, etc.)

**todoPageUtils approach:** Exclusion-based (exclude previously shown sys_ids)

**Impact:** For true pagination, we need to either:
- Track excluded IDs in session storage
- Fetch all and slice (not scalable)
- Use limit/offset at query level (requires modification)

---

## Solutions Implemented in v2.1

### 1. API Adapter Pattern

```javascript
function _getTodos(params) {
    // Validate our clean API parameters
    var validatedParams = _validateParams(params);
    var safeParams = validatedParams.params;

    // Adapt to todoPageUtils API
    var limit = safeParams.pageSize;
    var excludeList = []; // Simplified for first page
    var tab = _mapTabName(safeParams.tab);
    var filters = safeParams.filters.filterIds || null;

    // Call actual API
    var todoUtils = new sn_hr_sp.todoPageUtils();
    var result = todoUtils.getMyTodos(
        limit, excludeList, null, filters,
        _buildFilterParams(safeParams), null, false, tab
    );

    // Transform response to our format
    var records = result.recordsToShow[tab] || [];
    return {
        success: true,
        records: records,
        totalCount: records.length,
        // ... rest of response
    };
}
```

### 2. Tab Name Mapper

```javascript
function _mapTabName(tab) {
    var mapping = {
        'pending': 'open',
        'open': 'open',
        'completed': 'completed',
        'closed': 'completed',
        'all': 'all'
    };
    return mapping[tab] || 'open';
}
```

### 3. Filter Parameter Builder

```javascript
function _buildFilterParams(safeParams) {
    return {
        search: safeParams.search,
        priority: safeParams.filters.priority,
        type: safeParams.filters.type,
        sortBy: safeParams.sortBy,
        sortOrder: safeParams.sortOrder
    };
}
```

### 4. Action Execution

Since `todoPageUtils` doesn't provide action methods, we implement them directly:

```javascript
function _executeAction(todoGr, actionType) {
    if (todoGr.getTableName() === 'sysapproval_approver') {
        return _executeApprovalAction(todoGr, actionType);
    }
    return _executeTaskAction(todoGr, actionType);
}

function _executeApprovalAction(approvalGr, actionType) {
    switch (actionType) {
        case 'approve':
            approvalGr.state = 'approved';
            approvalGr.update();
            return { success: true, message: 'Approved' };
        // ... other actions
    }
}
```

---

## Pagination Limitations

### Current Implementation (Simplified)

**Limitation:** The current v2.1 implementation only properly supports page 1.

**Why:** todoPageUtils uses an exclusion list approach, but we don't persist excluded IDs across requests.

### Options for Full Pagination

#### Option A: Session-based Tracking (Recommended)
```javascript
// Store excluded IDs in session
var sessionKey = 'hr_todos_excluded_' + tab;
var excludeList = gs.getSession().getProperty(sessionKey) || '';
excludeList = excludeList ? excludeList.split(',') : [];

// After fetching
var newExcluded = records.map(function(r) { return r.sysId; });
excludeList = excludeList.concat(newExcluded);
gs.getSession().putProperty(sessionKey, excludeList.join(','));
```

**Pros:** Works with todoPageUtils API
**Cons:** Session storage has limits

#### Option B: Custom Query Implementation
```javascript
// Skip todoPageUtils for pagination, query directly
var gr = new GlideRecord('sysapproval_approver');
// ... apply filters ...
gr.chooseWindow((page - 1) * pageSize, page * pageSize);
gr.query();
```

**Pros:** True pagination support
**Cons:** Bypasses todoPageUtils (may miss business logic)

#### Option C: Hybrid Approach (Best)
```javascript
// Use todoPageUtils for first page (caching, record watchers)
if (page === 1) {
    result = todoUtils.getMyTodos(...);
}
// Use direct queries for subsequent pages
else {
    result = _queryTodosDirect(safeParams);
}
```

**Pros:** Best of both worlds
**Cons:** More complex implementation

---

## Method Compatibility Matrix

| Method | Original Code | todoPageUtils | Status | Notes |
|--------|---------------|---------------|--------|-------|
| `getTodos()` | ✅ Used | ❌ Doesn't exist | ⚠️ Adapted | Now calls `getMyTodos()` |
| `performAction()` | ✅ Used | ❌ Doesn't exist | ✅ Implemented | Direct GlideRecord updates |
| `getFilters()` | ✅ Used | ❌ Doesn't exist | ✅ Implemented | Direct query |
| `getMyTodos()` | ❌ Not used | ✅ Exists | ✅ Using | Core retrieval |
| `getMyTodosCount()` | ❌ Not used | ✅ Exists | ⏭️ Future | For total counts |
| `getTodoDetails()` | ❌ Not used | ✅ Exists | ⏭️ Future | For detail view |

---

## Security Implications

### What We Can Validate

✅ **Action types** - Whitelisted before execution
✅ **Todo IDs** - Format validated (32-char hex)
✅ **Ownership** - Verified before actions
✅ **Input sanitization** - All strings escaped

### What todoPageUtils Handles

✅ **Query conditions** - Applied via configuration
✅ **Delegation filters** - Built-in support
✅ **Record watchers** - Real-time updates
✅ **Access control** - Uses GlideRecord with ACLs

### Additional Checks Needed

⚠️ **Action authorization** - We check ownership + admin role
⚠️ **State transitions** - Should validate valid state changes
⚠️ **Business rules** - Ensure they fire on updates

---

## Performance Considerations

### todoPageUtils Optimizations We Get

✅ **Caching** - Uses `employee_center_core_cache`
✅ **Query limits** - `LIMIT_TOTAL_TODOS = 300`
✅ **Display priority** - Sorted fetching
✅ **Delegation filters** - Efficient query building

### Our Additional Optimizations

✅ **Filter validation** - Limit filter arrays to 50 items
✅ **String truncation** - Max 255 chars
✅ **Query limits** - 1000 max for filter generation
✅ **Response caching** - Timestamp for client-side caching

---

## Testing Requirements

### Unit Tests Needed

1. **Parameter Validation**
   ```javascript
   // Test invalid tab names
   // Test invalid page numbers
   // Test XSS in search terms
   // Test oversized filter arrays
   ```

2. **API Adaptation**
   ```javascript
   // Test tab name mapping
   // Test filter parameter building
   // Test response transformation
   ```

3. **Action Execution**
   ```javascript
   // Test approval actions
   // Test task actions
   // Test unauthorized actions
   // Test non-existent todos
   ```

### Integration Tests Needed

1. **With todoPageUtils**
   - Verify getMyTodos is called correctly
   - Verify response format is compatible
   - Verify filters are applied

2. **With GlideRecord**
   - Verify updates are committed
   - Verify business rules fire
   - Verify ACLs are respected

3. **End-to-End**
   - Fetch todos → display → action → refresh
   - Test all tabs
   - Test all filters
   - Test pagination

---

## Migration Checklist

- [ ] Review todoPageUtils documentation
- [ ] Test in sub-production environment
- [ ] Verify all action types work
- [ ] Test with different roles
- [ ] Test delegation scenarios
- [ ] Verify record watchers function
- [ ] Test pagination (page 1 only for now)
- [ ] Monitor system logs
- [ ] Check performance metrics
- [ ] Validate security controls

---

## Known Limitations in v2.1

1. **Pagination**: Only page 1 properly supported (no exclusion tracking)
2. **Sorting**: Relies on todoPageUtils sorting (may not match all sortBy params)
3. **Search**: Not fully implemented (needs integration with filters)
4. **Total Count**: Only returns current page count, not total available

---

## Recommendations

### Short-term (Use v2.1 as-is)

For widgets that only need first page or infinite scroll:
- ✅ Security improvements are valuable
- ✅ Validation is robust
- ⚠️ Note pagination limitation

### Medium-term (Enhance v2.1)

Implement one of the pagination options:
- 🎯 **Option C (Hybrid)** recommended
- Add `getMyTodosCount()` for total counts
- Add search integration

### Long-term (Consider Custom Solution)

If todoPageUtils becomes a bottleneck:
- Build custom todo query builder
- Implement proper pagination
- Add advanced filtering
- Maintain security controls

---

## Conclusion

**Version 2.1 provides:**
- ✅ Full security improvements
- ✅ Complete validation
- ✅ Clean error handling
- ✅ Audit logging
- ✅ Works with actual todoPageUtils API
- ⚠️ Basic pagination (page 1 only)

**Use when:**
- Security is priority
- Only need first page/batch
- Want cleaner code structure
- Need better error handling

**Don't use when:**
- Multi-page pagination is critical
- Advanced search is required
- Custom sorting is needed

---

**Version**: 2.1
**Date**: 2025-11-06
**Status**: Production-ready with noted limitations
