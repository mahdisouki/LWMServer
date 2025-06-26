# Driver & Helper APIs

This document describes the unified APIs that work for both drivers and helpers in the London Waste Management system.

## Overview

The APIs have been updated to support both drivers and helpers with the same endpoints. The system automatically detects the user type and provides appropriate functionality based on their role.

## Authentication

All endpoints require authentication using the `isAuth` middleware. Include the authentication token in the request headers:

```
Authorization: Bearer <your-token>
```

## API Endpoints

### 1. Profile Management

#### Update Profile
```
PUT /api/driver/profile
```

**Description:** Update user profile (works for both drivers and helpers)

**Form Data:**
- `email` (optional): Email address
- `officialEmail` (optional): Official email address
- `phoneNumber` (optional): Phone number(s)
- `username` (optional): Username
- `gender` (optional): Gender
- `designation` (optional): Job designation
- `dateOfBirth` (optional): Date of birth
- `address` (optional): Address
- `CIN` (optional): CIN number
- `password` (optional): New password
- `picture` (optional): Profile picture file
- `DriverLicense` (optional): Driver license file
- `addressProof` (optional): Address proof file
- `NatInsurance` (optional): National insurance file

**Response:**
```json
{
  "message": "Driver profile updated successfully",
  "user": {
    "username": "john_doe",
    "email": "john@example.com",
    "role": "Driver",
    "id": "user_id",
    "picture": "path/to/picture",
    "phoneNumber": "+1234567890",
    "address": "123 Main St",
    "CIN": "CIN123456",
    "DriverLicense": "path/to/license",
    "addressProof": "path/to/proof",
    "NatInsurance": "path/to/insurance"
  }
}
```

### 2. Task Management

#### Get Tasks
```
GET /api/driver/tasks
```

**Description:** Get tasks for the current day (works for both drivers and helpers)

**Response:**
```json
{
  "message": "Tasks for today retrieved successfully for Driver",
  "tasks": [...],
  "userType": "Driver"
}
```

#### Update Task Status
```
PUT /api/driver/tasks/update-status/:taskId
```

**Description:** Update the status of a specific task

**Body:**
```json
{
  "taskStatus": "In Progress"
}
```

**Response:**
```json
{
  "message": "Task status updated successfully by Driver",
  "task": {...},
  "userType": "Driver"
}
```

#### Rate Task
```
PUT /api/driver/tasks/rate/:taskId
```

**Description:** Rate and complete a task

**Body:**
```json
{
  "clientFeedback": "Great service!",
  "clientFeedbackScale": 5
}
```

**Response:**
```json
{
  "message": "Task rated successfully by Driver",
  "task": {...},
  "userType": "Driver"
}
```

### 3. Task Photo Uploads

#### Upload Initial Condition Photos
```
POST /api/driver/tasks/initial-photos/:taskId
```

**Description:** Upload initial condition photos for a task

**Form Data:**
- `description` (required): Description of the photos
- `uploads` (required): Photo files (multiple)

**Response:**
```json
{
  "message": "Initial condition photos uploaded successfully by Driver",
  "task": {...},
  "userType": "Driver"
}
```

#### Upload Final Condition Photos
```
POST /api/driver/tasks/final-photos/:taskId
```

**Description:** Upload final condition photos for a task

**Form Data:**
- `description` (required): Description of the photos
- `uploads` (required): Photo files (multiple)

#### Upload Intermediate Condition Photos
```
POST /api/driver/tasks/intermediate-photos/:taskId
```

**Description:** Upload intermediate condition photos for a task

**Form Data:**
- `description` (required): Description of the photos
- `uploads` (required): Photo files (multiple)

#### Upload Additional Items
```
POST /api/driver/tasks/additional-items/:taskId
```

**Description:** Upload additional items photos for a task

**Form Data:**
- `description` (required): Description of the items
- `uploads` (required): Photo files (multiple)

### 4. Truck Management

#### Update Truck Start Status
```
POST /api/driver/trucks/start/:truckId
```

**Description:** Update truck start status with photos and condition report

**Form Data:**
- `fuelLevel` (required): Fuel level at start
- `mileageStart` (required): Starting mileage
- `conditionReport` (optional): Condition report
- `uploads` (required): Photos of truck condition

#### Update Truck End Status
```
POST /api/driver/trucks/end/:truckId
```

**Description:** Update truck end status with photos and condition report

**Form Data:**
- `fuelLevelBefore` (required): Fuel level before
- `fuelLevelAfter` (required): Fuel level after
- `mileageEnd` (required): Ending mileage
- `conditionReport` (optional): Condition report
- `uploads` (required): Photos of truck condition

### 5. Partner Location

#### Get Partner Location
```
GET /api/driver/partner-location
```

**Description:** Get location of partner (helper location for driver, driver location for helper)

**Response for Driver:**
```json
{
  "message": "Helper location retrieved successfully",
  "location": {
    "latitude": 51.5074,
    "longitude": -0.1278,
    "address": "123 Main St, London"
  }
}
```

**Response for Helper:**
```json
{
  "message": "Driver location retrieved successfully",
  "location": {
    "latitude": 51.5074,
    "longitude": -0.1278,
    "address": "123 Main St, London"
  }
}
```

### 6. Break Management

#### Start Break
```
POST /api/driver/break/start
```

**Description:** Start a break for the user

**Response:**
```json
{
  "message": "Break started",
  "newBreak": {
    "startTime": "2024-01-01T10:00:00.000Z"
  },
  "userType": "Driver"
}
```

#### End Break
```
POST /api/driver/break/end
```

**Description:** End the current break

**Response:**
```json
{
  "message": "Break ended",
  "lastBreak": {
    "startTime": "2024-01-01T10:00:00.000Z",
    "endTime": "2024-01-01T10:30:00.000Z",
    "duration": 30
  },
  "userType": "Driver"
}
```

#### Get Break Timer
```
GET /api/driver/break
```

**Description:** Get current break status and timer

**Response:**
```json
{
  "message": "Break timer",
  "isActive": true,
  "elapsed": 1800,
  "userType": "Driver"
}
```

### 7. Day Management

#### Mark Day Start
```
POST /api/driver/mark-day-start
```

**Description:** Mark the start of the work day

**Body:**
```json
{
  "userId": "user_id",
  "userType": "Driver"
}
```

### 8. Database Maintenance

#### Cleanup Truck Tasks
```
POST /api/driver/cleanup-truck-tasks
```

**Description:** Clean up corrupted truck tasks data (admin only)

**Response:**
```json
{
  "message": "Truck tasks cleanup completed",
  "cleanedCount": 5
}
```

## User Type Detection

The system automatically detects whether the authenticated user is a driver or helper by:

1. First checking the `User` model for users with roles containing "Driver" or "Helper"
2. If not found, checking the `Driver` model
3. If not found, checking the `Helper` model

## Response Format

All responses include:
- `message`: Success/error message
- `userType`: The type of user (Driver/Helper) who performed the action
- `data`: The actual response data (where applicable)

## Error Handling

Common error responses:

```json
{
  "message": "User not found",
  "error": "User not found or not authorized"
}
```

```json
{
  "message": "No truck found for the given user.",
  "error": "No truck found for the given user."
}
```

## File Upload Limits

- **Maximum file size**: 25MB per file
- **Supported formats**: Images (JPEG, PNG, GIF, WebP), Documents (PDF, DOC, DOCX, XLS, XLSX), Text files
- **Storage**: Files are temporarily stored and automatically cleaned up after processing

## Security Features

1. **Authentication**: All endpoints require valid authentication
2. **Authorization**: Users can only access their own data
3. **File validation**: Only allowed file types are accepted
4. **Input validation**: All inputs are validated before processing
5. **Error logging**: Comprehensive error logging for debugging

## Migration Notes

- Existing driver-only endpoints have been updated to support helpers
- Backward compatibility is maintained
- New `userType` field is added to responses for clarity
- Route names have been updated to be more generic

## Testing

Test the APIs using tools like Postman or curl:

```bash
# Example: Get tasks
curl -X GET \
  http://localhost:3000/api/driver/tasks \
  -H 'Authorization: Bearer your-token'

# Example: Update profile
curl -X PUT \
  http://localhost:3000/api/driver/profile \
  -H 'Authorization: Bearer your-token' \
  -F 'username=john_doe' \
  -F 'email=john@example.com'
``` 