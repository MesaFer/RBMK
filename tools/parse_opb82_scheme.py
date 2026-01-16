#!/usr/bin/env python3
"""
OPB-82 Scheme Parser
Parses the RBMK-1000 reactor core layout image and extracts cell positions.
Uses connected components algorithm to find cells.

Cell types and their colors (hex):
- AZ (Emergency Rods): #DE1A03 (red) - 33 cells
- TK (Fuel Channels): #A5B5A4 (gray-green) - 1661 cells
- RR (Manual Control): #EBEBEB (light gray) - 146 cells
- AR (Automatic): #01B191 (teal/green) - 8 cells
- LAR (Local Auto): #0067CE (blue) - 12 cells
- USP (Shortened): #FED801 (yellow) - 24 cells

The image has grid lines every 8 cells that need to be removed during post-processing.
"""

import json
import sys
from pathlib import Path
from collections import deque

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

# Color definitions (RGB)
COLORS = {
    'AZ': (0xDE, 0x1A, 0x03),   # Red - Emergency Rods
    'TK': (0xA5, 0xB5, 0xA4),   # Gray-green - Fuel Channels
    'RR': (0xEB, 0xEB, 0xEB),   # Light gray - Manual Control
    'AR': (0x01, 0xB1, 0x91),   # Teal/Green - Automatic
    'LAR': (0x00, 0x67, 0xCE),  # Blue - Local Auto
    'USP': (0xFE, 0xD8, 0x01),  # Yellow - Shortened
}

# Color tolerance for matching
COLOR_TOLERANCE = 25

def color_distance(c1, c2):
    """Calculate Euclidean distance between two RGB colors."""
    return sum((a - b) ** 2 for a, b in zip(c1, c2)) ** 0.5

def identify_color(pixel):
    """Identify the cell type based on pixel color."""
    if len(pixel) == 4:  # RGBA
        pixel = pixel[:3]
    
    for cell_type, color in COLORS.items():
        if color_distance(pixel, color) < COLOR_TOLERANCE:
            return cell_type
    return None

def find_connected_components(img, target_color, tolerance=COLOR_TOLERANCE):
    """
    Find all connected components of a given color using flood fill.
    Returns list of (center_x, center_y, area) for each component.
    """
    width, height = img.size
    pixels = img.load()
    visited = set()
    components = []
    
    def matches_color(pixel):
        if len(pixel) == 4:
            pixel = pixel[:3]
        return color_distance(pixel, target_color) < tolerance
    
    def flood_fill(start_x, start_y):
        """BFS flood fill to find connected component."""
        if (start_x, start_y) in visited:
            return None
        if not matches_color(pixels[start_x, start_y]):
            return None
        
        queue = deque([(start_x, start_y)])
        component_pixels = []
        
        while queue:
            x, y = queue.popleft()
            if (x, y) in visited:
                continue
            if x < 0 or x >= width or y < 0 or y >= height:
                continue
            if not matches_color(pixels[x, y]):
                continue
            
            visited.add((x, y))
            component_pixels.append((x, y))
            
            # Add 4-connected neighbors
            queue.append((x + 1, y))
            queue.append((x - 1, y))
            queue.append((x, y + 1))
            queue.append((x, y - 1))
        
        if component_pixels:
            # Calculate center of mass
            sum_x = sum(p[0] for p in component_pixels)
            sum_y = sum(p[1] for p in component_pixels)
            center_x = sum_x / len(component_pixels)
            center_y = sum_y / len(component_pixels)
            return (center_x, center_y, len(component_pixels))
        return None
    
    # Scan image for components
    for y in range(height):
        for x in range(width):
            if (x, y) not in visited:
                component = flood_fill(x, y)
                if component:
                    components.append(component)
    
    return components


def normalize_coordinates(cells):
    """
    Post-process coordinates to remove grid line gaps.
    The OPB-82 scheme has grid lines that create gaps in the coordinate space.
    This function remaps coordinates to a continuous 48x48 grid.
    """
    # Collect all unique X and Y coordinates
    all_x = set()
    all_y = set()
    
    for cell_type, cell_list in cells.items():
        for cell in cell_list:
            all_x.add(cell['grid_x'])
            all_y.add(cell['grid_y'])
    
    # Sort and create mapping
    sorted_x = sorted(all_x)
    sorted_y = sorted(all_y)
    
    # Create mapping from old coordinates to new continuous coordinates
    x_map = {old: new for new, old in enumerate(sorted_x)}
    y_map = {old: new for new, old in enumerate(sorted_y)}
    
    print(f"\nCoordinate normalization:")
    print(f"  Original X range: {min(sorted_x)} - {max(sorted_x)} ({len(sorted_x)} unique values)")
    print(f"  Original Y range: {min(sorted_y)} - {max(sorted_y)} ({len(sorted_y)} unique values)")
    print(f"  New X range: 0 - {len(sorted_x) - 1}")
    print(f"  New Y range: 0 - {len(sorted_y) - 1}")
    
    # Apply mapping to all cells
    normalized_cells = {}
    for cell_type, cell_list in cells.items():
        normalized_cells[cell_type] = []
        for cell in cell_list:
            normalized_cells[cell_type].append({
                'grid_x': x_map[cell['grid_x']],
                'grid_y': y_map[cell['grid_y']],
                'original_grid_x': cell['grid_x'],
                'original_grid_y': cell['grid_y'],
                'pixel_x': cell['pixel_x'],
                'pixel_y': cell['pixel_y'],
                'area': cell['area'],
            })
    
    return normalized_cells


def parse_scheme(image_path, cell_size=26, output_path=None, min_area=100):
    """
    Parse the OPB-82 scheme image and extract cell positions.
    Uses connected components to find cells.
    
    Args:
        image_path: Path to the scheme image
        cell_size: Approximate size of each cell in pixels
        output_path: Path to save the JSON output
        min_area: Minimum area (in pixels) for a valid cell
    
    Returns:
        Dictionary with cell positions by type
    """
    print(f"Loading image: {image_path}")
    img = Image.open(image_path)
    width, height = img.size
    print(f"Image size: {width}x{height}")
    
    # Convert to RGB if necessary
    if img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Results storage
    cells = {
        'AZ': [],
        'TK': [],
        'RR': [],
        'AR': [],
        'LAR': [],
        'USP': [],
    }
    
    # Find connected components for each color
    for cell_type, color in COLORS.items():
        print(f"Finding {cell_type} cells (color: #{color[0]:02X}{color[1]:02X}{color[2]:02X})...")
        components = find_connected_components(img, color)
        
        # Filter by minimum area and convert to grid coordinates
        for center_x, center_y, area in components:
            if area >= min_area:
                grid_x = int(center_x / cell_size)
                grid_y = int(center_y / cell_size)
                
                cells[cell_type].append({
                    'grid_x': grid_x,
                    'grid_y': grid_y,
                    'pixel_x': int(center_x),
                    'pixel_y': int(center_y),
                    'area': area,
                })
    
    # Print raw statistics
    print("\n=== Raw Cell Statistics ===")
    total = 0
    for cell_type, positions in cells.items():
        count = len(positions)
        total += count
        print(f"{cell_type}: {count} cells")
    print(f"Total: {total} cells")
    
    # Normalize coordinates to remove grid line gaps
    cells = normalize_coordinates(cells)
    
    # Print normalized statistics
    print("\n=== Normalized Cell Statistics ===")
    total = 0
    for cell_type, positions in cells.items():
        count = len(positions)
        total += count
        print(f"{cell_type}: {count} cells")
    print(f"Total: {total} cells")
    
    # Find grid bounds after normalization
    all_x = []
    all_y = []
    for cell_list in cells.values():
        for cell in cell_list:
            all_x.append(cell['grid_x'])
            all_y.append(cell['grid_y'])
    
    grid_width = max(all_x) - min(all_x) + 1 if all_x else 0
    grid_height = max(all_y) - min(all_y) + 1 if all_y else 0
    print(f"Grid size: {grid_width} x {grid_height}")
    
    # Prepare output
    output = {
        'metadata': {
            'image_size': {'width': width, 'height': height},
            'cell_size': cell_size,
            'total_cells': total,
            'grid_size': {'width': grid_width, 'height': grid_height},
        },
        'cells': cells,
        'positions_by_type': {}
    }
    
    # Convert to simple coordinate format for TypeScript
    for cell_type, positions in cells.items():
        output['positions_by_type'][cell_type] = [
            f"{p['grid_x']},{p['grid_y']}" for p in positions
        ]
    
    # Save to JSON
    if output_path is None:
        output_path = Path(image_path).with_suffix('.json')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\nOutput saved to: {output_path}")
    
    # Also generate TypeScript code
    ts_output = generate_typescript(cells)
    ts_path = Path(output_path).with_suffix('.ts')
    with open(ts_path, 'w', encoding='utf-8') as f:
        f.write(ts_output)
    print(f"TypeScript code saved to: {ts_path}")
    
    return output

def generate_typescript(cells):
    """Generate TypeScript code for the cell positions."""
    lines = [
        "// Auto-generated from OPB-82 scheme image",
        "// Cell positions extracted by parse_opb82_scheme.py",
        "// Coordinates are normalized to a continuous grid (grid lines removed)",
        "",
    ]
    
    for cell_type, positions in cells.items():
        if not positions:
            continue
        
        lines.append(f"// {cell_type} positions - {len(positions)} cells")
        lines.append(f"const {cell_type.lower()}Positions = new Set<string>([")
        
        # Group by row for readability
        by_row = {}
        for p in positions:
            row = p['grid_y']
            if row not in by_row:
                by_row[row] = []
            by_row[row].append(p['grid_x'])
        
        for row in sorted(by_row.keys()):
            cols = sorted(set(by_row[row]))  # Remove duplicates within same row
            pos_str = ', '.join(f"'{col},{row}'" for col in cols)
            lines.append(f"    // Row {row}")
            lines.append(f"    {pos_str},")
        
        lines.append("]);")
        lines.append("")
    
    return '\n'.join(lines)

def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_opb82_scheme.py <image_path> [cell_size] [min_area]")
        print("\nExample:")
        print("  python parse_opb82_scheme.py opb82_scheme.png 26 100")
        sys.exit(1)
    
    image_path = sys.argv[1]
    cell_size = int(sys.argv[2]) if len(sys.argv) > 2 else 26
    min_area = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    
    parse_scheme(image_path, cell_size, min_area=min_area)

if __name__ == '__main__':
    main()
