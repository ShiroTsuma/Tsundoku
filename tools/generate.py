import pandas as pd
import random
import argparse
from pathlib import Path

def randomize_string(text):
    if not text or pd.isna(text):
        return ""
    text = str(text)
    
    if len(text) > 6 and random.random() < 0.2:
        start = random.randint(0, len(text) - 5)
        end = random.randint(start + 4, len(text))
        text = text[start:end]
        
    case_mod = random.random()
    if case_mod < 0.15:
        text = text.lower()
    elif case_mod < 0.30:
        text = text.upper()
        
    if ' ' in text or random.random() < 0.2:
        quote = random.choice(['"', "'"])
        text = f"{quote}{text}{quote}"
        
    return text

def generate_queries(filepath, output_file, total_queries, general_search_count, split_weights):
    df = pd.read_csv(filepath)
    
    gs_flags = [True] * general_search_count + [False] * (total_queries - general_search_count)
    random.shuffle(gs_flags)
    
    # Opcje ilości atrybutów odpowiadają długości podanej tablicy split
    num_attributes_options = list(range(1, len(split_weights) + 1))
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for has_general in gs_flags:
            book = df.sample(1).iloc[0]
            components = []
            
            book_data = {}
            if pd.notna(book['primaryTitle']): book_data['title'] = book['primaryTitle']
            if pd.notna(book['authorName']): book_data['author'] = book['authorName']
            if pd.notna(book['contentType']): book_data['type'] = book['contentType']
            if pd.notna(book['status']): book_data['status'] = book['status']
            
            if pd.notna(book['genres']): 
                book_data['genre'] = random.choice([g.strip() for g in str(book['genres']).split(';')])
            if pd.notna(book['tags']): 
                book_data['tag'] = random.choice([t.strip() for t in str(book['tags']).split(';')])

            keys = list(book_data.keys())
            random.shuffle(keys)
            
            # Losowanie docelowej liczby atrybutów dla tego zapytania
            attributes_to_use = random.choices(num_attributes_options, weights=split_weights, k=1)[0]
            
            if has_general and keys:
                gen_key = keys.pop()
                val = randomize_string(book_data[gen_key])
                if val:
                    components.append(val)
                    attributes_to_use -= 1 
                    
            attributes_to_use = min(attributes_to_use, len(keys))
            
            for _ in range(attributes_to_use):
                if not keys: break
                field = keys.pop()
                val = randomize_string(book_data[field])
                if val:
                    components.append(f"{field}:{val}")
            
            # Negacja (10% szans) dodawana niezależnie od limitu
            if random.random() < 0.1:
                other_book = df.sample(1).iloc[0]
                if pd.notna(other_book['tags']):
                    other_tag = random.choice([t.strip() for t in str(other_book['tags']).split(';')])
                    if pd.isna(book['tags']) or other_tag not in str(book['tags']):
                        components.append(f"-tag:{randomize_string(other_tag)}")

            random.shuffle(components)
            query = " ".join(components)
            
            if query.strip():
                print(query) 
                f.write(query + "\n")

    print(f"\n--- Pomyślnie wygenerowano {total_queries} zapytań do pliku: {output_file} ---")

if __name__ == "__main__":
    default_input = Path(__file__).with_name("books-export.csv")
    parser = argparse.ArgumentParser(description="Generator zapytań dla Tsundoku.")
    parser.add_argument("--count", type=int, default=20, help="Łączna liczba zapytań do wygenerowania")
    parser.add_argument("--general", type=int, default=5, help="Ilość zapytań zawierających General Search (<= count)")
    parser.add_argument("--output", type=str, default="queries.txt", help="Nazwa pliku wyjściowego")
    parser.add_argument("--split", type=str, default="50:30:20", help="Wagi dla ilości filtrów (np. 50:30:20 oznacza 1, 2 i 3 filtry)")
    args = parser.parse_args()
    
    if args.general > args.count:
        print("Błąd: Ilość zapytań 'general' nie może być większa niż łączna ilość zapytań 'count'.")
        exit(1)
        
    try:
        split_weights = [float(x) for x in args.split.split(':')]
    except ValueError:
        print("Błąd: Parametr --split musi składać się z liczb oddzielonych dwukropkiem (np. 50:30:20:10)")
        exit(1)
        
    generate_queries(default_input, args.output, args.count, args.general, split_weights)
