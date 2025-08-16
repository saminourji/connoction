import logging
import sys
from datetime import datetime
from pathlib import Path

def setup_logging(log_level: str = "INFO"):
    """Setup structured logging for the application."""
    
    # Create logs directory
    log_dir = Path(__file__).parent.parent / "logs"
    log_dir.mkdir(exist_ok=True)
    
    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s:%(lineno)d | %(message)s'
    )
    
    simple_formatter = logging.Formatter(
        '%(asctime)s | %(levelname)-8s | %(message)s'
    )
    
    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Console handler (simple format)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(simple_formatter)
    console_handler.setLevel(logging.INFO)
    root_logger.addHandler(console_handler)
    
    # File handler (detailed format)
    today = datetime.now().strftime("%Y-%m-%d")
    file_handler = logging.FileHandler(log_dir / f"connoction-{today}.log")
    file_handler.setFormatter(detailed_formatter)
    file_handler.setLevel(logging.DEBUG)
    root_logger.addHandler(file_handler)
    
    # Error file handler
    error_handler = logging.FileHandler(log_dir / f"errors-{today}.log")
    error_handler.setFormatter(detailed_formatter)
    error_handler.setLevel(logging.ERROR)
    root_logger.addHandler(error_handler)
    
    return root_logger

def get_logger(name: str):
    """Get a logger for a specific module."""
    return logging.getLogger(name)
