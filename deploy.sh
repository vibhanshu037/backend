#!/bin/bash

# Video Conferencing Platform Deployment Script
# This script sets up and deploys the complete video conferencing platform

set -e

echo "🚀 Video Conferencing Platform Deployment"
echo "=========================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check Node.js (for local development)
    if ! command -v node &> /dev/null; then
        print_warning "Node.js is not installed. This is required for local development."
    else
        NODE_VERSION=$(node --version)
        print_success "Node.js version: $NODE_VERSION"
    fi
    
    print_success "All dependencies are available!"
}

# Setup environment variables
setup_environment() {
    print_status "Setting up environment variables..."
    
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
# MongoDB configuration
MONGODB_URI=mongodb://localhost:27017/video_conference_main
USER_DB_URI=mongodb://localhost:27017/video_conference_users
MEETING_DB_URI=mongodb://localhost:27017/video_conference_meetings
CHAT_DB_URI=mongodb://localhost:27017/video_conference_chat
FILE_DB_URI=mongodb://localhost:27017/video_conference_files
RECORDING_DB_URI=mongodb://localhost:27017/video_conference_recordings

# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT configuration
JWT_SECRET=video_conference_jwt_secret_key_2024_$(openssl rand -hex 32)
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=video_conference_refresh_secret_2024_$(openssl rand -hex 32)
JWT_REFRESH_EXPIRE=30d

# Microservices ports
API_GATEWAY_PORT=3000
MEDIA_SERVER_PORT=3001
CHAT_SERVICE_PORT=3002
USER_SERVICE_PORT=3003
RECORDING_SERVICE_PORT=3004
NOTIFICATION_SERVICE_PORT=3005
FILE_SERVICE_PORT=3006

# WebRTC configuration
TURN_SERVER_URL=turn:localhost:3478
TURN_USERNAME=videoconf
TURN_PASSWORD=secretpassword

# File upload configuration
UPLOAD_PATH=./uploads
RECORDING_PATH=./recordings
MAX_FILE_SIZE=104857600

# Email configuration (configure for production)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASS=

# Security configuration
SESSION_SECRET=video_conference_session_secret_2024_$(openssl rand -hex 32)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Node environment
NODE_ENV=development

# Logging
LOG_LEVEL=info
EOF
        print_warning "Please configure the .env file with your settings before proceeding."
    else
        print_success "Environment file found!"
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    
    if [ -f package.json ]; then
        npm install
        print_success "Dependencies installed successfully!"
    else
        print_error "package.json not found!"
        exit 1
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p uploads/images
    mkdir -p uploads/documents
    mkdir -p uploads/avatars
    mkdir -p uploads/thumbnails
    mkdir -p recordings/video
    mkdir -p recordings/audio
    mkdir -p recordings/temp
    
    print_success "Directories created successfully!"
}

# Development deployment
deploy_development() {
    print_status "Deploying for development..."
    
    # Install dependencies
    install_dependencies
    
    # Create directories
    create_directories
    
    print_success "Development setup completed!"
    print_status "You can now start the services:"
    echo ""
    echo "  Individual services:"
    echo "    npm run start:gateway     # API Gateway (port 3000)"
    echo "    npm run start:user        # User Service (port 3003)"
    echo "    npm run start:media       # Media Server (port 3001)"
    echo "    npm run start:chat        # Chat Service (port 3002)"
    echo "    npm run start:file        # File Service (port 3006)"
    echo "    npm run start:recording   # Recording Service (port 3004)"
    echo "    npm run start:notification# Notification Service (port 3005)"
    echo ""
    echo "  All services at once:"
    echo "    npm run start:all"
    echo ""
    echo "  Development mode:"
    echo "    npm run dev"
}

# Docker deployment
deploy_docker() {
    print_status "Deploying with Docker..."
    
    # Build Docker images
    print_status "Building Docker images..."
    docker-compose build
    
    # Start services
    print_status "Starting services..."
    docker-compose up -d
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 30
    
    # Check service health
    print_status "Checking service health..."
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_success "API Gateway is healthy!"
    else
        print_error "API Gateway health check failed!"
    fi
    
    print_success "Docker deployment completed!"
    print_status "Services are running on:"
    echo "  - API Gateway: http://localhost:3000"
    echo "  - User Service: http://localhost:3003"
    echo "  - Media Server: http://localhost:3001"
    echo "  - Chat Service: http://localhost:3002"
    echo "  - File Service: http://localhost:3006"
    echo "  - Recording Service: http://localhost:3004"
    echo "  - Notification Service: http://localhost:3005"
    echo ""
    echo "To view logs: docker-compose logs -f"
    echo "To stop services: docker-compose down"
}

# Production deployment
deploy_production() {
    print_status "Deploying for production..."
    
    # Set production environment
    export NODE_ENV=production
    
    # Validate required environment variables
    if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "your_super_secret_jwt_key_change_in_production" ]; then
        print_error "Please set secure JWT_SECRET in production!"
        exit 1
    fi
    
    # Deploy with Docker
    deploy_docker
    
    print_success "Production deployment completed!"
    print_warning "Don't forget to:"
    echo "  1. Configure SSL certificates for HTTPS"
    echo "  2. Set up proper firewall rules"
    echo "  3. Configure monitoring and alerts"
    echo "  4. Set up backup procedures"
    echo "  5. Configure email settings for notifications"
}

# Health check
health_check() {
    print_status "Performing health check..."
    
    services=("3000" "3001" "3002" "3003" "3004" "3005" "3006")
    service_names=("API Gateway" "Media Server" "Chat Service" "User Service" "Recording Service" "Notification Service" "File Service")
    
    for i in "${!services[@]}"; do
        port=${services[i]}
        name=${service_names[i]}
        
        if curl -f http://localhost:$port/health > /dev/null 2>&1; then
            print_success "$name (port $port) is healthy"
        else
            print_error "$name (port $port) is not responding"
        fi
    done
}

# Show usage
usage() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  dev, development    Deploy for development"
    echo "  docker             Deploy with Docker"
    echo "  prod, production   Deploy for production"
    echo "  health             Check service health"
    echo "  stop               Stop all services"
    echo "  help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 dev             # Development deployment"
    echo "  $0 docker          # Docker deployment"
    echo "  $0 prod            # Production deployment"
}

# Stop services
stop_services() {
    print_status "Stopping services..."
    
    # Stop Docker services
    if [ -f docker-compose.yml ]; then
        docker-compose down
        print_success "Docker services stopped!"
    fi
    
    # Kill any Node.js processes (development)
    pkill -f "node services/" 2>/dev/null || true
    print_success "Local services stopped!"
}

# Main script logic
main() {
    case "$1" in
        "dev"|"development")
            check_dependencies
            setup_environment
            deploy_development
            ;;
        "docker")
            check_dependencies
            setup_environment
            deploy_docker
            ;;
        "prod"|"production")
            check_dependencies
            setup_environment
            deploy_production
            ;;
        "health")
            health_check
            ;;
        "stop")
            stop_services
            ;;
        "help"|"--help"|"-h"|"")
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"